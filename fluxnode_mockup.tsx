import React, { useState } from 'react';
import { Film, Cpu, Layout, Clock } from 'lucide-react';

export default function App() {
  const [view, setView] = useState('workflow'); // 'workflow' or 'timeline'

  return (
    <div className="flex flex-col w-full h-screen bg-[#0d0d0d] text-white font-sans overflow-hidden">
      {/* HEADER: Branding and Global Navigation */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-[#0d0d0d]">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#e0ff00] to-green-500 flex items-center justify-center text-black font-bold text-lg">
            F
          </div>
          <h1 className="text-xl font-bold tracking-tight">FluxNode</h1>
        </div>

        <div className="flex bg-[#1c1c1e] p-1 rounded-full border border-white/10">
          <button 
            onClick={() => setView('timeline')}
            className={`px-6 py-1.5 rounded-full text-sm font-medium transition flex items-center gap-2 ${view === 'timeline' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white'}`}
          >
            <Clock size={16} /> Timeline
          </button>
          <button 
            onClick={() => setView('workflow')}
            className={`px-6 py-1.5 rounded-full text-sm font-medium transition flex items-center gap-2 ${view === 'workflow' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white'}`}
          >
            <Layout size={16} /> Workflow
          </button>
        </div>

        <div className="flex items-center gap-4">
           <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1c1c1e] rounded-full border border-white/10 text-xs">
             <Cpu size={14} className="text-yellow-400" />
             <span>Local (Comfy)</span>
           </div>
           <button className="bg-white text-black px-4 py-2 rounded-full text-sm font-medium hover:bg-gray-200 transition">
             Render
           </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden relative">
         {view === 'workflow' ? <WorkflowView /> : <TimelineView />}
      </main>
    </div>
  );
}

function WorkflowView() {
  return (
    <div className="w-full h-full relative overflow-auto cursor-grab active:cursor-grabbing bg-[#0d0d0d]">
      <div className="absolute inset-0 z-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #333 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>
      
      {/* Node Canvas Area */}
      <div className="relative w-[1600px] h-[900px] p-12">
        {/* Simplified Nodes representation for FluxNode branding */}
        <div className="absolute top-[280px] left-[50px] w-72 bg-[#1c1c1e]/90 backdrop-blur-md border border-white/10 rounded-2xl p-4 z-20 shadow-2xl">
          <h3 className="font-medium text-sm mb-4">Media Source (Track 1)</h3>
          <div className="bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
            <Film size={14} className="text-gray-400" /> sci-fi-scene-01.mp4
          </div>
        </div>
        
        {/* Additional Nodes... */}
      </div>
    </div>
  );
}

function TimelineView() {
  return (
    <div className="w-full h-full flex items-center justify-center text-gray-500">
      Timeline View Content Placeholder
    </div>
  );
}
