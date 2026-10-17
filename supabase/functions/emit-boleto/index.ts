// emit-boleto — integração com a API de Cobrança v3 do Banco Inter.
//
// Ações (campo `action` no corpo; padrão "emit"):
//   test     → só autentica no Inter (não gera cobrança). Admin.
//   emit     → { installment_id, vencimento? }  emite boleto+PIX da parcela.
//   refresh  → { boleto_id }       consulta a cobrança e atualiza dados/situação.
//   pdf      → { boleto_id }       devolve o PDF em base64.
//   cancel   → { boleto_id, motivo } cancela a cobrança no Inter.
//
// Sem credenciais salvas (ambiente "simulado"), "emit" gera um boleto
// fictício para o fluxo da tela continuar funcionando.
//
// No Inter v3 a emissão é assíncrona: o POST devolve só o
// codigoSolicitacao; linha digitável, código de barras e PIX vêm no GET
// da cobrança. Por isso a emissão grava "Processando" e consulta em
// seguida; se o Inter ainda não tiver terminado, o botão "Atualizar" da
// tela busca de novo.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import https from 'node:https';

const BASE_URL: Record<string, string> = {
  producao: 'https://cdpj.partners.bancointer.com.br',
  sandbox: 'https://cdpj-sandbox.partners.uatinter.co',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Creds = {
  environment: string; client_id: string; client_secret: string;
  cert_pem: string; key_pem: string; conta_corrente: string | null;
};

class UserError extends Error {}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Data de hoje no fuso de Brasília (toISOString usa UTC e vira o dia às 21h).
const todayBR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

const UF_BY_NAME: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', goias: 'GO', maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};
// Aceita sigla ou nome por extenso (com ou sem acento).
function toUF(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const key = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return UF_BY_NAME[key] ?? null;
}

// ---------- HTTP com certificado (mTLS) ----------

async function interRequest(
  creds: Creds, method: string, path: string, headers: Record<string, string>, body?: string,
): Promise<{ status: number; text: string }> {
  const url = new URL(BASE_URL[creds.environment] + path);
  // Prefere o cliente mTLS nativo do Deno; se o runtime não tiver, usa node:https.
  // deno-lint-ignore no-explicit-any
  const D = Deno as any;
  if (typeof D.createHttpClient === 'function') {
    const client = D.createHttpClient({
      cert: creds.cert_pem, key: creds.key_pem,
      certChain: creds.cert_pem, privateKey: creds.key_pem, // nomes do Deno 1.x
    });
    try {
      const res = await fetch(url, { method, headers, body, client } as RequestInit);
      return { status: res.status, text: await res.text() };
    } finally {
      client.close?.();
    }
  }
  return await new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, cert: creds.cert_pem, key: creds.key_pem }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken(creds: Creds): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    scope: 'boleto-cobranca.write boleto-cobranca.read',
  }).toString();
  const res = await interRequest(creds, 'POST', '/oauth/v2/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' }, body);
  if (res.status !== 200) throw new UserError(`Falha ao autenticar no Inter (${res.status}): ${res.text.slice(0, 500)}`);
  return JSON.parse(res.text).access_token as string;
}

async function interApi(creds: Creds, token: string, method: string, path: string, payload?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (creds.conta_corrente) headers['x-conta-corrente'] = creds.conta_corrente;
  const res = await interRequest(creds, method, `/cobranca/v3/cobrancas${path}`, headers,
    payload === undefined ? undefined : JSON.stringify(payload));
  if (res.status < 200 || res.status >= 300) {
    throw new UserError(`Inter respondeu ${res.status}: ${res.text.slice(0, 800)}`);
  }
  return res.text ? JSON.parse(res.text) : {};
}

// Situação do Inter → status no sistema.
function statusFrom(situacao: string | undefined, hasBoleto: boolean): string {
  switch (situacao) {
    case 'RECEBIDO':
    case 'MARCADO_RECEBIDO': return 'Pago';
    case 'CANCELADO': return 'Cancelado';
    case 'EXPIRADO': return 'Expirado';
    default: return hasBoleto ? 'Emitido' : 'Processando';
  }
}

// deno-lint-ignore no-explicit-any
function fieldsFromDetail(d: any) {
  const linha = d?.boleto?.linhaDigitavel ?? null;
  return {
    linha_digitavel: linha,
    codigo_barras: d?.boleto?.codigoBarras ?? null,
    nosso_numero: d?.boleto?.nossoNumero ?? null,
    pix_copia_cola: d?.pix?.pixCopiaECola ?? null,
    situacao: d?.cobranca?.situacao ?? null,
    status: statusFrom(d?.cobranca?.situacao, !!linha),
  };
}

function fakeBoleto(seuNumero: string, valor: number) {
  const rand = () => Math.floor(Math.random() * 1e9).toString().padStart(9, '0');
  return {
    linha_digitavel: `08497.${rand().slice(0, 5)} ${rand().slice(0, 5)}.${rand().slice(0, 6)} ${rand().slice(0, 5)}.${rand().slice(0, 6)} 9 ${Date.now().toString().slice(-14)}`,
    codigo_barras: `0${rand()}${rand()}${rand()}${rand()}${rand()}`,
    pix_copia_cola: `00020126SIMULADO-${seuNumero}-${Math.round(valor * 100)}5204000053039865802BR5913LASER TOOLS6009SAO PAULO62070503***6304SIMU`,
    nosso_numero: rand(),
    codigo_solicitacao: crypto.randomUUID(),
  };
}

// ---------- Ações ----------

async function loadCreds(db: SupabaseClient): Promise<Creds | null> {
  const { data } = await db.from('bank_credentials').select('*').eq('id', 'inter').single();
  if (!data || !BASE_URL[data.environment]) return null;
  if (!data.client_id || !data.client_secret || !data.cert_pem || !data.key_pem) return null;
  return data as Creds;
}

async function emit(db: SupabaseClient, installmentId: string, vencimentoOverride?: string) {
  const { data: inst, error } = await db
    .from('installments')
    .select('*, customer:customer_id(*), sale:sale_id(customer_id)')
    .eq('id', installmentId)
    .single();
  if (error || !inst) throw new UserError('Parcela não encontrada.');
  if (inst.paid) throw new UserError('Esta parcela já está paga.');

  let customer = inst.customer;
  const customerId = inst.customer_id ?? inst.sale?.customer_id ?? null;
  if (!customer && customerId) {
    ({ data: customer } = await db.from('customers').select('*').eq('id', customerId).single());
  }

  const valor = Math.round((Number(inst.amount) - Number(inst.paid_amount || 0)) * 100) / 100;
  if (valor <= 0) throw new UserError('Não há saldo em aberto nesta parcela.');

  const { count } = await db.from('boletos').select('id', { count: 'exact', head: true }).eq('installment_id', installmentId);
  const seuNumero = `P${installmentId.replace(/-/g, '').slice(0, 10)}-${(count ?? 0) + 1}`.slice(0, 15);
  // Parcela vencida: a tela pede uma nova data, que vale só para o boleto.
  const vencimento: string = vencimentoOverride || inst.due_date;
  if (vencimentoOverride && !/^\d{4}-\d{2}-\d{2}$/.test(vencimentoOverride)) throw new UserError('Data de vencimento inválida.');
  const base = { installment_id: installmentId, customer_id: customerId, valor, vencimento, seu_numero: seuNumero };

  const creds = await loadCreds(db);
  if (!creds) {
    const { data: boleto, error: insErr } = await db.from('boletos')
      .insert({ ...base, status: 'Simulado', ...fakeBoleto(seuNumero, valor) }).select().single();
    if (insErr) throw insErr;
    return boleto;
  }

  // Validações que o Inter exige antes de qualquer chamada.
  if (vencimento < todayBR()) {
    throw new UserError('O vencimento já passou. Informe uma nova data de vencimento para o boleto.');
  }
  const doc = digits(customer?.document);
  const missing: string[] = [];
  if (!customer) missing.push('cliente vinculado à parcela');
  if (customer && !customer.name) missing.push('nome');
  if (customer && doc.length !== 11 && doc.length !== 14) missing.push('CPF/CNPJ válido');
  if (customer && !customer.address) missing.push('endereço');
  if (customer && !customer.city) missing.push('cidade');
  const uf = toUF(customer?.state);
  if (customer && !uf) missing.push('UF (sigla, ex.: SP)');
  if (customer && digits(customer.cep).length !== 8) missing.push('CEP');
  if (missing.length) {
    throw new UserError(`Complete o cadastro do cliente${customer?.name ? ` "${customer.name}"` : ''} em Clientes: ${missing.join(', ')}.`);
  }

  // Reserva a parcela antes de chamar o Inter (o índice único barra duplicidade).
  const { data: row, error: resErr } = await db.from('boletos').insert({ ...base, status: 'Processando' }).select().single();
  if (resErr) {
    if ((resErr as { code?: string }).code === '23505') throw new UserError('Já existe um boleto ativo para esta parcela.');
    throw resErr;
  }

  try {
    const token = await getToken(creds);
    const pagador: Record<string, string> = {
      cpfCnpj: doc,
      tipoPessoa: doc.length === 14 ? 'JURIDICA' : 'FISICA',
      nome: String(customer.name).slice(0, 100),
      endereco: String(customer.address).slice(0, 100),
      cidade: String(customer.city).slice(0, 60),
      uf: uf!,
      cep: digits(customer.cep),
    };
    if (customer.address_number) pagador.numero = String(customer.address_number).slice(0, 10);
    if (customer.address_complement) pagador.complemento = String(customer.address_complement).slice(0, 30);
    if (customer.neighborhood) pagador.bairro = String(customer.neighborhood).slice(0, 60);
    if (customer.email) pagador.email = String(customer.email).slice(0, 50);

    const created = await interApi(creds, token, 'POST', '', {
      seuNumero,
      valorNominal: valor,
      dataVencimento: vencimento,
      numDiasAgenda: 30,
      pagador,
      mensagem: { linha1: `Parcela ${inst.installment_number} - Laser Tools Componentes` },
    });
    const codigo = created.codigoSolicitacao as string;
    await db.from('boletos').update({ codigo_solicitacao: codigo, updated_at: new Date().toISOString() }).eq('id', row.id);

    // Emissão assíncrona: tenta buscar os dados algumas vezes.
    for (let i = 0; i < 3; i++) {
      await sleep(1500);
      try {
        const detail = await interApi(creds, token, 'GET', `/${codigo}`);
        const f = fieldsFromDetail(detail);
        if (f.linha_digitavel) {
          const { data: done } = await db.from('boletos')
            .update({ ...f, updated_at: new Date().toISOString() }).eq('id', row.id).select().single();
          return done;
        }
      } catch { /* ainda processando */ }
    }
    const { data: pending } = await db.from('boletos').select('*').eq('id', row.id).single();
    return pending;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Só marca erro se o Inter não chegou a registrar a cobrança.
    const { data: cur } = await db.from('boletos').select('codigo_solicitacao').eq('id', row.id).single();
    if (!cur?.codigo_solicitacao) {
      await db.from('boletos').update({ status: 'Erro', erro_mensagem: msg, updated_at: new Date().toISOString() }).eq('id', row.id);
    }
    throw e;
  }
}

async function loadBoleto(db: SupabaseClient, boletoId: string) {
  const { data, error } = await db.from('boletos').select('*').eq('id', boletoId).single();
  if (error || !data) throw new UserError('Boleto não encontrado.');
  return data;
}

async function refresh(db: SupabaseClient, boletoId: string) {
  const b = await loadBoleto(db, boletoId);
  if (b.status === 'Simulado' || !b.codigo_solicitacao) return b;
  const creds = await loadCreds(db);
  if (!creds) throw new UserError('Credenciais do Inter não configuradas.');
  const token = await getToken(creds);
  const f = fieldsFromDetail(await interApi(creds, token, 'GET', `/${b.codigo_solicitacao}`));
  const { data } = await db.from('boletos').update({
    ...f,
    linha_digitavel: f.linha_digitavel ?? b.linha_digitavel,
    codigo_barras: f.codigo_barras ?? b.codigo_barras,
    nosso_numero: f.nosso_numero ?? b.nosso_numero,
    pix_copia_cola: f.pix_copia_cola ?? b.pix_copia_cola,
    erro_mensagem: null,
    updated_at: new Date().toISOString(),
  }).eq('id', boletoId).select().single();
  return data;
}

async function pdf(db: SupabaseClient, boletoId: string) {
  const b = await loadBoleto(db, boletoId);
  if (b.status === 'Simulado') throw new UserError('Boleto simulado não tem PDF.');
  if (!b.codigo_solicitacao) throw new UserError('O Inter ainda não registrou esta cobrança.');
  const creds = await loadCreds(db);
  if (!creds) throw new UserError('Credenciais do Inter não configuradas.');
  const token = await getToken(creds);
  const res = await interApi(creds, token, 'GET', `/${b.codigo_solicitacao}/pdf`);
  if (!res.pdf) throw new UserError('O Inter não devolveu o PDF. Tente "Atualizar" e depois baixe de novo.');
  return res.pdf as string;
}

async function cancel(db: SupabaseClient, boletoId: string, motivo: string) {
  const b = await loadBoleto(db, boletoId);
  if (b.status === 'Pago') throw new UserError('Boleto já pago não pode ser cancelado.');
  if (b.status !== 'Simulado' && b.codigo_solicitacao) {
    const creds = await loadCreds(db);
    if (!creds) throw new UserError('Credenciais do Inter não configuradas.');
    const token = await getToken(creds);
    await interApi(creds, token, 'POST', `/${b.codigo_solicitacao}/cancelar`, {
      motivoCancelamento: (motivo || 'Cancelado pelo emissor').slice(0, 50),
    });
  }
  const { data } = await db.from('boletos').update({
    status: 'Cancelado', situacao: b.status === 'Simulado' ? b.situacao : 'CANCELADO', updated_at: new Date().toISOString(),
  }).eq('id', boletoId).select().single();
  return data;
}

// ---------- Entrada ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Só admin e financeiro emitem/cancelam (clientes do Portal também têm login).
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Sessão inválida. Entre de novo no sistema.' }, 401);
    const { data: profile } = await db.from('profiles').select('role, active').eq('id', user.id).single();
    if (!profile?.active || !['admin', 'financeiro'].includes(profile.role)) {
      return json({ error: 'Apenas administradores e o financeiro podem gerenciar boletos.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? 'emit';

    switch (action) {
      case 'test': {
        if (profile.role !== 'admin') return json({ error: 'Apenas administradores podem testar a conexão.' }, 403);
        const creds = await loadCreds(db);
        if (!creds) throw new UserError('Nenhuma credencial completa salva ainda.');
        await getToken(creds);
        return json({ ok: true, environment: creds.environment });
      }
      case 'emit':
        if (!body.installment_id) throw new UserError('installment_id é obrigatório.');
        return json({ boleto: await emit(db, body.installment_id, body.vencimento) });
      case 'refresh':
        return json({ boleto: await refresh(db, body.boleto_id) });
      case 'pdf':
        return json({ pdf: await pdf(db, body.boleto_id) });
      case 'cancel':
        return json({ boleto: await cancel(db, body.boleto_id, body.motivo ?? '') });
      default:
        throw new UserError(`Ação desconhecida: ${action}`);
    }
  } catch (e) {
    // Erros de negócio voltam com 200 para a tela conseguir ler a mensagem
    // (o supabase-js descarta o corpo de respostas não-2xx).
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, e instanceof UserError ? 200 : 500);
  }
});
