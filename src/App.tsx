import { useState } from 'react';
import logo from './assets/logo.png';
import {
  LayoutDashboard, Package, Truck, ShoppingCart, Receipt, Users as UsersIcon,
  Wallet, Boxes, Menu, X, ClipboardList, Wrench, Settings as SettingsIcon,
  LogOut, Loader2, ShieldAlert, KeyRound,
} from 'lucide-react';
import { useSessionState } from './lib/useSessionState';
import { useAuth } from './lib/useAuth';
import { ROLE_LABELS } from './lib/supabase';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Parts from './components/Parts';
import MaintenanceScreen from './components/Maintenance';
import Settings from './components/Settings';
import Suppliers from './components/Suppliers';
import Purchases from './components/Purchases';
import Orders from './components/Orders';
import Sales from './components/Sales';
import Customers from './components/Customers';
import Financial from './components/Financial';
import Payables from './components/Payables';
import Competition from './components/Competition';
import UsersScreen from './components/Users';
import ChangePassword from './components/ChangePassword';

type ViewId =
  | 'dashboard' | 'parts' | 'suppliers' | 'orders' | 'purchases'
  | 'sales' | 'customers' | 'financial' | 'payables' | 'maintenance'
  | 'competition' | 'settings' | 'users';

// undefined roles = every role can see it (besides 'sem_papel', which never
// sees anything — gated separately, before the menu even renders).
type NavItem = { id: ViewId; label: string; icon: typeof Package; roles?: string[] };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: 'Visão Geral',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Cadastros',
    items: [
      { id: 'parts', label: 'Peças', icon: Boxes, roles: ['admin', 'vendedor', 'estoque_compras'] },
      { id: 'suppliers', label: 'Fornecedores', icon: Truck, roles: ['admin', 'estoque_compras'] },
      { id: 'customers', label: 'Clientes', icon: UsersIcon, roles: ['admin', 'vendedor'] },
      { id: 'competition', label: 'Concorrentes', icon: UsersIcon, roles: ['admin', 'estoque_compras'] },
    ],
  },
  {
    label: 'Operações',
    items: [
      { id: 'orders', label: 'Pedidos', icon: ClipboardList, roles: ['admin', 'vendedor', 'estoque_compras'] },
      { id: 'purchases', label: 'Compras', icon: ShoppingCart, roles: ['admin', 'estoque_compras'] },
      { id: 'sales', label: 'Vendas', icon: Receipt, roles: ['admin', 'vendedor'] },
      { id: 'maintenance', label: 'Manutenções', icon: Wrench, roles: ['admin', 'estoque_compras'] },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      { id: 'financial', label: 'Contas a Receber', icon: Wallet, roles: ['admin', 'financeiro'] },
      { id: 'payables', label: 'Contas a Pagar', icon: Wallet, roles: ['admin', 'financeiro'] },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { id: 'users', label: 'Usuários', icon: UsersIcon, roles: ['admin'] },
      { id: 'settings', label: 'Configurações', icon: SettingsIcon, roles: ['admin'] },
    ],
  },
];

function PendingApproval({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm text-center">
        <ShieldAlert size={40} className="text-amber-500 mx-auto mb-4" />
        <h1 className="text-lg font-bold text-slate-900 mb-2">Aguardando liberação</h1>
        <p className="text-sm text-slate-500 mb-1">
          Sua conta (<span className="font-medium text-slate-700">{email}</span>) foi criada, mas ainda não tem
          nenhum papel de acesso atribuído.
        </p>
        <p className="text-sm text-slate-500 mb-6">Peça a um administrador do sistema para liberar seu acesso.</p>
        <button className="btn-secondary" onClick={onSignOut}>Sair</button>
      </div>
    </div>
  );
}

export default function App() {
  const { session, profile, loading, signOut } = useAuth();
  const [view, setView] = useSessionState<ViewId>('app:view', 'dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [autoOpenNewCustomer, setAutoOpenNewCustomer] = useState(false);

  const goToNewCustomer = () => {
    setAutoOpenNewCustomer(true);
    setView('customers');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!session) return <Login />;

  if (!profile || profile.role === 'sem_papel' || !profile.active) {
    return <PendingApproval email={session.user.email ?? ''} onSignOut={signOut} />;
  }

  const role = profile.role;
  const visibleGroups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((n) => !n.roles || n.roles.includes(role)) }))
    .filter((g) => g.items.length > 0);
  const navItems = visibleGroups.flatMap((g) => g.items);
  const current = navItems.find((n) => n.id === view) ?? navItems[0];

  const render = () => {
    switch (current.id) {
      case 'dashboard': return <Dashboard />;
      case 'parts': return <Parts />;
      case 'maintenance': return <MaintenanceScreen />;
      case 'suppliers': return <Suppliers />;
      case 'orders': return <Orders />;
      case 'purchases': return <Purchases />;
      case 'sales': return <Sales onNewCustomer={goToNewCustomer} />;
      case 'customers': return <Customers autoOpenNew={autoOpenNewCustomer} onAutoOpenNewConsumed={() => setAutoOpenNewCustomer(false)} />;
      case 'financial': return <Financial />;
      case 'payables': return <Payables />;
      case 'competition': return <Competition />;
      case 'settings': return <Settings />;
      case 'users': return <UsersScreen myId={session.user.id} />;
    }
  };

  return (
    <div className="flex h-full bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200">
          <img src={logo} alt="Laser Tools Components" className="w-36 object-contain" />
          <button className="ml-auto lg:hidden icon-btn" onClick={() => setMobileOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div className="px-3 mb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{group.label}</div>
              <div className="space-y-1">
                {group.items.map((n) => {
                  const active = current.id === n.id;
                  const Icon = n.icon;
                  return (
                    <button
                      key={n.id}
                      onClick={() => { setView(n.id); setMobileOpen(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        active
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <Icon size={18} className={active ? 'text-white' : 'text-slate-400'} />
                      {n.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
              {(profile.full_name || profile.email).slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-700 truncate">{profile.full_name || profile.email}</div>
              <div className="text-[10px] text-slate-400 truncate">{ROLE_LABELS[role] ?? role}</div>
            </div>
            <div className="ml-auto flex items-center gap-1 shrink-0">
              <button className="icon-btn" title="Trocar senha" onClick={() => setChangingPassword(true)}>
                <KeyRound size={16} />
              </button>
              <button className="icon-btn" title="Sair" onClick={() => signOut()}>
                <LogOut size={16} />
              </button>
            </div>
          </div>
          <div className="text-[11px] text-slate-400">© 2026 LaserTools Componentes</div>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white/80 backdrop-blur border-b border-slate-200 flex items-center gap-3 px-4 lg:px-8 sticky top-0 z-20">
          <button className="lg:hidden icon-btn" onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <current.icon size={20} className="text-slate-400" />
            <h1 className="text-lg font-bold text-slate-900">{current.label}</h1>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          {render()}
        </main>
      </div>
      {changingPassword && <ChangePassword onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
