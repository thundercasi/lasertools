import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { supabase, type CustomerGroup } from '../lib/supabase';

type PickerCustomer = { id: string; name: string; group_id?: string | null };

// Cache simples dos grupos para não buscar de novo a cada combo aberto.
let groupsCache: CustomerGroup[] | null = null;
let groupsPromise: Promise<CustomerGroup[]> | null = null;
function loadGroups(): Promise<CustomerGroup[]> {
  if (groupsCache) return Promise.resolve(groupsCache);
  if (!groupsPromise) {
    groupsPromise = Promise.resolve(
      supabase.from('customer_groups').select('*').order('name').then(({ data }) => {
        groupsCache = (data as CustomerGroup[]) ?? [];
        groupsPromise = null;
        return groupsCache;
      }),
    );
  }
  return groupsPromise;
}
/** Chame após criar/renomear/excluir grupos para os combos recarregarem. */
export function invalidateCustomerGroups() { groupsCache = null; }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Seleção de cliente com combo de Grupo + busca por nome.
 * - value/onChange: id do cliente ('' = nenhum / todos).
 * - group/onGroupChange: opcional, para quando a tela também filtra por grupo (ex.: lista de vendas).
 */
export default function CustomerPicker({
  customers, value, onChange,
  placeholder = '— Selecione —',
  emptyLabel,
  onNewCustomer,
  group: groupProp, onGroupChange,
  label,
  className = '',
}: {
  customers: PickerCustomer[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** Texto da opção "vazia" na lista (ex.: "Todos os clientes"). Se omitido, não aparece. */
  emptyLabel?: string;
  onNewCustomer?: () => void;
  group?: string;
  onGroupChange?: (groupId: string) => void;
  /** Rótulo customizado de cada cliente na lista (ex.: com contagem de vendas). */
  label?: (c: PickerCustomer) => string;
  className?: string;
}) {
  const [groups, setGroups] = useState<CustomerGroup[]>(groupsCache ?? []);
  const [groupState, setGroupState] = useState('');
  const group = groupProp ?? groupState;
  const setGroup = (g: string) => { if (onGroupChange) onGroupChange(g); else setGroupState(g); };

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadGroups().then(setGroups); }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const list = useMemo(() => {
    const nq = norm(q.trim());
    return customers.filter((c) =>
      (!group || (group === '__none' ? !c.group_id : c.group_id === group)) &&
      (!nq || norm(c.name).includes(nq)));
  }, [customers, group, q]);

  const selected = customers.find((c) => c.id === value);
  const text = (c: PickerCustomer) => (label ? label(c) : c.name);

  type Opt = { id: string; text: string; kind: 'empty' | 'customer' | 'new' };
  const options: Opt[] = [
    ...(emptyLabel !== undefined ? [{ id: '', text: emptyLabel, kind: 'empty' as const }] : []),
    ...list.map((c) => ({ id: c.id, text: text(c), kind: 'customer' as const })),
    ...(onNewCustomer ? [{ id: '__new__', text: '+ Novo cliente...', kind: 'new' as const }] : []),
  ];

  const choose = (o: Opt) => {
    setOpen(false); setQ('');
    if (o.kind === 'new') { onNewCustomer?.(); return; }
    onChange(o.id);
  };

  const openList = () => { setOpen(true); setHi(0); setTimeout(() => inputRef.current?.focus(), 0); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (options[hi]) choose(options[hi]); }
    else if (e.key === 'Escape') { setOpen(false); setQ(''); }
  };

  return (
    <div className={`flex gap-2 min-w-0 ${className}`}>
      {groups.length > 0 && (
        <select className="input w-36 shrink-0" title="Grupo" value={group}
          onChange={(e) => {
            const g = e.target.value;
            setGroup(g);
            // Cliente selecionado fora do grupo escolhido é limpo.
            if (value && g) {
              const c = customers.find((x) => x.id === value);
              if (c && (g === '__none' ? c.group_id : c.group_id !== g)) onChange('');
            }
          }}>
          <option value="">Todos os grupos</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          <option value="__none">Sem grupo</option>
        </select>
      )}
      <div ref={boxRef} className="relative flex-1 min-w-0">
        {open ? (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input ref={inputRef} className="input pl-9" placeholder="Digite o nome do cliente..."
              value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onKey} />
          </div>
        ) : (
          <button type="button" className="input flex items-center justify-between gap-2 text-left w-full"
            onClick={openList} onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); openList(); } }}>
            <span className={`truncate ${selected ? 'text-slate-900' : 'text-slate-400'}`}>
              {selected ? text(selected) : (emptyLabel ?? placeholder)}
            </span>
            <span className="flex items-center gap-1 shrink-0 text-slate-400">
              {selected && emptyLabel !== undefined && (
                <X size={14} className="hover:text-slate-700" onClick={(e) => { e.stopPropagation(); onChange(''); }} />
              )}
              <ChevronDown size={16} />
            </span>
          </button>
        )}
        {open && (
          <ul className="absolute z-50 mt-1 w-full max-h-64 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-sm">
            {options.length === 0 && <li className="px-3 py-2 text-slate-400">Nenhum cliente encontrado</li>}
            {options.map((o, i) => (
              <li key={o.id || '__empty'}
                className={`px-3 py-2 cursor-pointer ${i === hi ? 'bg-sky-50' : ''} ${o.id === value && o.kind === 'customer' ? 'font-semibold text-sky-700' : ''} ${o.kind !== 'customer' ? 'text-slate-500' : 'text-slate-800'}`}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(o); }}>
                {o.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
