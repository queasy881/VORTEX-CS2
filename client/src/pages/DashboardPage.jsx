import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import MyFilesTab from '../components/MyFilesTab.jsx';
import SharedWithMeTab from '../components/SharedWithMeTab.jsx';
import FriendsTab from '../components/FriendsTab.jsx';
import UploadModal from '../components/UploadModal.jsx';

const TABS = [
  { id: 'mine', label: 'My Files' },
  { id: 'shared', label: 'Shared With Me' },
  { id: 'friends', label: 'Friends' },
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
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-brand-500">P2P Share</h1>
            <span className="text-slate-500">|</span>
            <span className="text-slate-300 text-sm">{user?.username}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowUpload(true)} className="btn-primary text-sm">
              + Upload
            </button>
            <button onClick={logout} className="btn-secondary text-sm">
              Logout
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4">
          <nav className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                  activeTab === tab.id
                    ? 'border-brand-500 text-brand-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        {activeTab === 'mine' && <MyFilesTab key={`mine-${refreshKey}`} />}
        {activeTab === 'shared' && <SharedWithMeTab key={`shared-${refreshKey}`} />}
        {activeTab === 'friends' && <FriendsTab key={`friends-${refreshKey}`} />}
      </main>

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onComplete={onUploadComplete} />
      )}
    </div>
  );
}
