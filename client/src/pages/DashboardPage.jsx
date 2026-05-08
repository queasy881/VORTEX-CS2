import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import MyFilesTab from '../components/MyFilesTab.jsx';
import SharedWithMeTab from '../components/SharedWithMeTab.jsx';
import FriendsTab from '../components/FriendsTab.jsx';
import UploadModal from '../components/UploadModal.jsx';

const TABS = [
  { id: 'mine', label: 'My Files', icon: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4' },
  { id: 'shared', label: 'Shared With Me', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
  { id: 'friends', label: 'Friends', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
];

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('mine');
  const [showUpload, setShowUpload] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  function onUploadComplete() {
    setShowUpload(false);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="app-bg min-h-screen flex flex-col relative">
      <header className="sticky top-0 z-30 border-b border-white/5 backdrop-blur-xl bg-ink-950/70">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4 animate-fade-in">
            <div className="w-10 h-10 rounded-xl bg-grad-primary flex items-center justify-center shadow-glow-violet">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <div className="font-display font-bold text-lg gradient-text leading-none">VORTEX</div>
              <div className="text-xs text-slate-500 mt-0.5">@{user?.username}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowUpload(true)} className="btn-primary group">
              <svg className="w-4 h-4 mr-2 transition-transform group-hover:scale-110 group-hover:rotate-90 duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Upload
            </button>
            <button onClick={logout} className="btn-secondary">
              Logout
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6">
          <nav className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`tab-btn flex items-center gap-2 ${activeTab === tab.id ? 'active' : ''}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                </svg>
                {tab.label}
                {activeTab === tab.id && <span className="tab-indicator" />}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8 relative z-10">
        <div key={`${activeTab}-${refreshKey}`} className="animate-fade-in">
          {activeTab === 'mine' && <MyFilesTab />}
          {activeTab === 'shared' && <SharedWithMeTab />}
          {activeTab === 'friends' && <FriendsTab />}
        </div>
      </main>

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onComplete={onUploadComplete} />
      )}
    </div>
  );
}
