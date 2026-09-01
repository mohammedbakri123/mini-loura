import { useEffect, useState } from 'react';

export function Overview({ onSelectCase }: { onSelectCase: (id: string) => void }) {
  const [cases, setCases] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);

  const load = async () => {
    try {
      const c = await fetch('/api/cases').then(r => r.json());
      const a = await fetch('/api/audit').then(r => r.json());
      if (Array.isArray(c)) setCases(c);
      if (Array.isArray(a)) setAudit(a);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold text-white">Overview</h2>
      
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-zinc-800/50 p-4 rounded border border-zinc-800">
          <div className="text-sm text-zinc-400">Active Cases</div>
          <div className="text-3xl font-light text-white mt-1">{cases.length}</div>
        </div>
        <div className="bg-zinc-800/50 p-4 rounded border border-zinc-800">
          <div className="text-sm text-zinc-400">Audit Events</div>
          <div className="text-3xl font-light text-white mt-1">{audit.length}</div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-medium text-white">Active Cases</h3>
        {cases.length === 0 ? (
          <div className="text-sm text-zinc-500">No active cases.</div>
        ) : (
          <div className="grid gap-2">
            {cases.map(c => (
              <div 
                key={c.id} 
                onClick={() => onSelectCase(c.id)}
                className="bg-zinc-800/30 border border-zinc-800 p-4 rounded cursor-pointer hover:border-zinc-600 transition-colors flex justify-between items-center"
              >
                <div>
                  <div className="text-sm text-emerald-400 font-mono mb-1">{c.type.toUpperCase()}</div>
                  <div className="font-medium text-white">{c.title}</div>
                  <div className="text-xs text-zinc-500 mt-1">{c.id}</div>
                </div>
                <div className={`px-2 py-1 text-xs font-bold rounded ${
                  c.status === 'RESOLVED' ? 'bg-emerald-950 text-emerald-400' :
                  c.status === 'ACTION_REQUIRED' ? 'bg-amber-950 text-amber-400' :
                  'bg-zinc-800 text-zinc-300'
                }`}>
                  {c.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
