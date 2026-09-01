import { useState } from 'react';
import { Overview } from './pages/Overview';
import { DemoScenarios } from './pages/DemoScenarios';
import { CaseDetail } from './pages/CaseDetail';

export function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'demos'>('overview');
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);

  const navigateToCase = (id: string) => {
    setActiveCaseId(id);
  };

  const navItemClass = (id: string) => `block w-full text-left px-4 py-2 text-sm cursor-pointer ${
    !activeCaseId && activeTab === id ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
  }`;

  return (
    <div className="flex h-screen overflow-hidden text-zinc-300">
      {/* Sidebar */}
      <div className="w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800 mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
            <h1 className="text-zinc-100 font-mono font-bold tracking-tight">mini-loura</h1>
          </div>
          <div className="text-[10px] text-zinc-500 mt-1 uppercase tracking-widest font-mono">
            System Operational
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          <button
            onClick={() => { setActiveTab('overview'); setActiveCaseId(null); }}
            className={navItemClass('overview')}
          >
            Overview
          </button>
          
          <div className="px-4 py-2 mt-4 text-xs font-semibold text-zinc-600 uppercase tracking-wider">
            Demo Scenarios
          </div>
          <button
            onClick={() => { setActiveTab('demos'); setActiveCaseId(null); }}
            className={navItemClass('demos')}
          >
            Run Scenarios
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 bg-zinc-900 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-8">
          {activeCaseId ? (
            <CaseDetail caseId={activeCaseId} onBack={() => setActiveCaseId(null)} />
          ) : activeTab === 'overview' ? (
            <Overview onSelectCase={navigateToCase} />
          ) : (
            <DemoScenarios onSelectCase={navigateToCase} />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
