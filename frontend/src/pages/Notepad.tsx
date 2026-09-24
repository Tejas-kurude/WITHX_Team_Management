import { useEffect, useState, useRef, ChangeEvent } from 'react';
import { api, messageOf } from '../services/api';
import { PageTitle, Modal } from '../components/UI';
import {
  StickyNote,
  Plus,
  Search,
  Trash2,
  Save,
  Clock,
  CheckCircle2,
  FileText,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface Note {
  id: number;
  user_id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export default function Notepad() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedStatus, setSavedStatus] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState('');
  const [deleteModalId, setDeleteModalId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Editor states
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  // Save timeout ref
  const saveTimeoutRef = useRef<number | null>(null);

  // Fetch notes
  const fetchNotes = async (selectId?: number) => {
    try {
      setLoading(true);
      setErrorMsg('');
      const res = await api.get('/notes', {
        params: searchQuery ? { q: searchQuery } : undefined,
      });
      const data: Note[] = Array.isArray(res.data) ? res.data : [];
      setNotes(data);

      if (selectId) {
        setActiveNoteId(selectId);
      } else if (data.length > 0 && !activeNoteId) {
        setActiveNoteId(data[0].id);
      } else if (data.length === 0) {
        setActiveNoteId(null);
      }
    } catch (e) {
      setErrorMsg(messageOf(e));
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    void fetchNotes();
  }, []);

  // Search filter effect
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchNotes(activeNoteId || undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Sync editor when active note changes
  useEffect(() => {
    if (activeNoteId) {
      const active = notes.find((n) => n.id === activeNoteId);
      if (active) {
        setEditTitle(active.title || '');
        setEditContent(active.content || '');
        setIsDirty(false);
        setSavedStatus('');
      }
    } else {
      setEditTitle('');
      setEditContent('');
      setIsDirty(false);
    }
  }, [activeNoteId, notes]);

  // Create a new note
  const handleCreateNote = async () => {
    try {
      setSaving(true);
      setErrorMsg('');
      const res = await api.post('/notes', {
        title: 'Untitled Note',
        content: '',
      });
      const newNote = res.data;
      setNotes((prev) => [newNote, ...prev]);
      setActiveNoteId(newNote.id);
      setEditTitle(newNote.title);
      setEditContent(newNote.content);
      setIsDirty(false);
      setSavedStatus('Created');
      setTimeout(() => setSavedStatus(''), 2500);
    } catch (e) {
      setErrorMsg(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  // Save active note
  const handleSaveNote = async () => {
    if (!activeNoteId) return;
    try {
      setSaving(true);
      setErrorMsg('');
      const res = await api.put(`/notes/${activeNoteId}`, {
        title: editTitle.trim() || 'Untitled Note',
        content: editContent,
      });
      const updated = res.data;

      // Update local state
      setNotes((prev) =>
        prev.map((n) => (n.id === activeNoteId ? updated : n))
      );
      setIsDirty(false);
      setSavedStatus('Saved');
      setTimeout(() => setSavedStatus(''), 3000);
    } catch (e) {
      setErrorMsg(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  // Delete note
  const handleDeleteNote = async () => {
    if (!deleteModalId) return;
    try {
      setDeleting(true);
      await api.delete(`/notes/${deleteModalId}`);
      const remaining = notes.filter((n) => n.id !== deleteModalId);
      setNotes(remaining);
      setDeleteModalId(null);
      if (activeNoteId === deleteModalId) {
        setActiveNoteId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch (e) {
      setErrorMsg(messageOf(e));
    } finally {
      setDeleting(false);
    }
  };

  // Keyboard shortcut Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void handleSaveNote();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeNoteId, editTitle, editContent]);

  // Format date
  const formatDate = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  const activeNote = notes.find((n) => n.id === activeNoteId);

  return (
    <>
      <PageTitle
        title="Personal Notepad"
        subtitle="Create, organize, and maintain your private notes and action items"
        action={
          <button
            type="button"
            className="btn btn-accent flex items-center gap-2"
            onClick={handleCreateNote}
            disabled={saving}
          >
            <Plus size={16} />
            New Note
          </button>
        }
      />

      {errorMsg && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
          <button
            className="text-xs font-bold underline"
            onClick={() => setErrorMsg('')}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Notepad Container */}
      <div className="card overflow-hidden p-0 shadow-lg border border-slate-200 grid grid-cols-1 lg:grid-cols-12 min-h-[640px] max-h-[820px]">
        {/* Left Side: Notes List & Search */}
        <div className="lg:col-span-4 border-r border-slate-200 bg-white flex flex-col h-full">
          {/* Search Header */}
          <div className="p-4 border-b border-slate-100 bg-[#FAF7F2]">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3.5 top-3 text-slate-400"
              />
              <input
                type="text"
                className="input pl-10 pr-4 py-2 text-sm bg-white rounded-xl border-[#D8C8B5]"
                placeholder="Search notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Notes List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 no-scrollbar">
            {loading ? (
              <div className="py-16 text-center text-sm font-semibold text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw size={16} className="animate-spin text-navy" />
                Loading notes...
              </div>
            ) : notes.length > 0 ? (
              notes.map((note) => {
                const isActive = note.id === activeNoteId;
                const preview = note.content
                  ? note.content.replace(/\s+/g, ' ').slice(0, 75)
                  : 'No content yet...';

                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => {
                      if (isDirty && activeNoteId !== note.id) {
                        void handleSaveNote();
                      }
                      setActiveNoteId(note.id);
                    }}
                    className={`w-full text-left p-4 transition-all flex items-start gap-3 relative ${
                      isActive
                        ? 'bg-[#F4EFE6] border-l-4 border-l-navy'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="p-2 rounded-lg bg-orange/10 text-orange shrink-0 mt-0.5">
                      <StickyNote size={16} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <h4
                          className={`text-sm truncate font-bold ${
                            isActive ? 'text-navy' : 'text-slate-800'
                          }`}
                        >
                          {note.title || 'Untitled Note'}
                        </h4>
                        <span className="text-[11px] font-semibold text-slate-400 shrink-0">
                          {formatDate(note.updated_at || note.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                        {preview}
                      </p>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="p-8 text-center text-slate-400">
                <StickyNote size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm font-semibold text-slate-600">
                  {searchQuery ? 'No matching notes found' : 'No notes yet'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {searchQuery
                    ? 'Try searching with another keyword'
                    : 'Click "New Note" to create your first personal note.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Note Editor */}
        <div className="lg:col-span-8 bg-[#FBFBFA] flex flex-col h-full">
          {activeNote ? (
            <>
              {/* Editor Top Bar */}
              <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Clock size={14} />
                  <span>
                    Last updated {formatDate(activeNote.updated_at || activeNote.created_at)}
                  </span>
                  {savedStatus && (
                    <span className="flex items-center gap-1 text-emerald-600 font-bold ml-2 animate-in fade-in">
                      <CheckCircle2 size={13} />
                      {savedStatus}
                    </span>
                  )}
                  {isDirty && !savedStatus && (
                    <span className="text-amber-600 font-bold ml-2">• Unsaved changes</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDeleteModalId(activeNote.id)}
                    className="btn btn-secondary text-xs text-red-600 hover:bg-red-50 border-red-200 flex items-center gap-1.5 py-1.5 px-3"
                    title="Delete Note"
                  >
                    <Trash2 size={14} />
                    <span>Delete</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveNote}
                    disabled={saving}
                    className="btn btn-primary text-xs flex items-center gap-1.5 py-1.5 px-4"
                    title="Save Note (Ctrl+S)"
                  >
                    {saving ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    ) : (
                      <Save size={14} />
                    )}
                    <span>Save</span>
                  </button>
                </div>
              </div>

              {/* Title & Body Inputs */}
              <div className="flex-1 flex flex-col p-6 overflow-y-auto">
                <input
                  type="text"
                  placeholder="Note Title..."
                  value={editTitle}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setEditTitle(e.target.value);
                    setIsDirty(true);
                  }}
                  className="text-2xl font-extrabold text-navy placeholder:text-slate-300 bg-transparent border-none outline-none mb-4 pb-2 border-b border-slate-200 focus:border-orange transition-colors"
                />

                <textarea
                  placeholder="Start typing your note here... (Ctrl+S to save)"
                  value={editContent}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                    setEditContent(e.target.value);
                    setIsDirty(true);
                  }}
                  className="flex-1 w-full text-sm leading-relaxed text-slate-700 placeholder:text-slate-300 bg-transparent border-none outline-none resize-none font-sans"
                  style={{ minHeight: '380px' }}
                />
              </div>

              {/* Editor Footer */}
              <div className="px-6 py-3 border-t border-slate-200 bg-white text-[11px] text-slate-400 flex items-center justify-between">
                <div>
                  {editContent.trim() ? editContent.trim().split(/\s+/).length : 0} words •{' '}
                  {editContent.length} characters
                </div>
                <div className="font-semibold text-slate-400">
                  Tip: Press <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px]">Ctrl+S</kbd> to quickly save
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                <FileText size={32} />
              </div>
              <h3 className="font-extrabold text-base text-navy">
                No Note Selected
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">
                Choose an existing note from the sidebar or start fresh with a new note.
              </p>
              <button
                type="button"
                className="btn btn-primary text-xs flex items-center gap-1.5"
                onClick={handleCreateNote}
              >
                <Plus size={14} />
                Create New Note
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModalId && (
        <Modal
          title="Delete Note"
          onClose={() => setDeleteModalId(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Are you sure you want to delete this note? This action cannot be undone.
            </p>

            <div className="flex justify-end gap-3 pt-3">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteModalId(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn bg-red-600 hover:bg-red-700 text-white"
                onClick={handleDeleteNote}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete Note'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
