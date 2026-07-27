import { useState } from 'react';
import {
  LayoutDashboard, Package, Truck, ShoppingCart, Receipt, Users,
  Wallet, Search, Boxes, Menu, X, ClipboardList,
} from 'lucide-react';
import { useSessionState } from './lib/useSessionState';
import Dashboard from './components/Dashboard';
import Parts from './components/Parts';
import Suppliers from './components/Suppliers';
import Purchases from './components/Purchases';
import Orders from './components/Orders';
import Sales from './components/Sales';
import Customers from './components/Customers';
import Financial from './components/Financial';
import Payables from './components/Payables';
import Competition from './components/Competition';

type ViewId =
  | 'dashboard' | 'parts' | 'suppliers' | 'orders' | 'purchases'
  | 'sales' | 'customers' | 'financial' | 'payables' | 'competition';

const navItems: { id: ViewId; label: string; icon: typeof Package }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'parts', label: 'Peças', icon: Boxes },
  { id: 'suppliers', label: 'Fornecedores', icon: Truck },
  { id: 'orders', label: 'Pedidos', icon: ClipboardList },
  { id: 'purchases', label: 'Compras', icon: ShoppingCart },
  { id: 'sales', label: 'Vendas', icon: Receipt },
  { id: 'customers', label: 'Clientes', icon: Users },
  { id: 'financial', label: 'Contas a Receber', icon: Wallet },
  { id: 'payables', label: 'Contas a Pagar', icon: Wallet },
  { id: 'competition', label: 'Concorrentes', icon: Users },
];

export default function App() {
  const [view, setView] = useSessionState<ViewId>('app:view', 'dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);

  const current = navItems.find((n) => n.id === view)!;

  const render = () => {
    switch (view) {
      case 'dashboard': return <Dashboard />;
      case 'parts': return <Parts />;
      case 'suppliers': return <Suppliers />;
      case 'orders': return <Orders />;
      case 'purchases': return <Purchases />;
      case 'sales': return <Sales />;
      case 'customers': return <Customers />;
      case 'financial': return <Financial />;
      case 'payables': return <Payables />;
      case 'competition': return <Competition />;
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
        <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-200">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 flex items-center justify-center shadow-sm">
            <Package className="text-white" size={20} />
          </div>
          <div>
            <div className="font-bold text-slate-900 leading-tight">LaserParts</div>
            <div className="text-[11px] text-slate-400 font-medium tracking-wide">ERP</div>
          </div>
          <button className="ml-auto lg:hidden icon-btn" onClick={() => setMobileOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((n) => {
            const active = view === n.id;
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
        </nav>
        <div className="p-4 border-t border-slate-200">
          <div className="text-[11px] text-slate-400">© 2026 LaserParts ERP</div>
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
    </div>
  );
}
