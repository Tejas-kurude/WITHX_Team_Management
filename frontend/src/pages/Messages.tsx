import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, messageOf } from '../services/api';
import { Empty, PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import {
  MessageSquare,
  Search,
  Send,
  User,
  Plus,
  Clock,
  Shield,
  Briefcase,
  Building2,
  CheckCheck,
  RefreshCw,
} from 'lucide-react';

interface Conversation {
  id: number;
  created_at: string;
  updated_at: string;
  last_message_text: string | null;
  last_message_at: string | null;
  last_read_at: string;
  unread_count: number;
  other_user_id: number;
  other_user_code: string;
  other_user_name: string;
  other_user_type: string;
  other_user_job_title: string | null;
  other_user_photo: string | null;
  other_user_department: string | null;
  other_user_role: string;
}

interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  message_text: string;
  created_at: string;
  sender_code: string;
  sender_name: string;
  is_mine: boolean;
}

interface SearchUser {
  id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  job_title: string | null;
  user_type: string;
  profile_photo_url: string | null;
  department_name: string | null;
  role: string;
}

export default function Messages() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [convSearch, setConvSearch] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // New Chat Modal / Search State
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<SearchUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // Load conversation list
  const loadConversations = async (silent = false) => {
    try {
      if (!silent) setLoadingConvs(true);
      const res = await api.get('/messages/conversations');
      const data = Array.isArray(res.data) ? res.data : [];
      setConversations(data);

      // Auto-select first conversation if none selected
      if (!activeConvId && data.length > 0) {
        setActiveConvId(data[0].id);
      }
    } catch (e) {
      if (!silent) setErrorMsg(messageOf(e));
    } finally {
      if (!silent) setLoadingConvs(false);
    }
  };

  // Load messages for selected conversation
  const loadMessages = async (convId: number, silent = false) => {
    try {
      if (!silent) setLoadingMessages(true);
      const res = await api.get(`/messages/conversations/${convId}/messages`);
      const msgs = Array.isArray(res.data) ? res.data : [];
      setMessages(msgs);

      // Update unread count locally in conversations state
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c))
      );

      if (!silent) {
        setTimeout(() => scrollToBottom('auto'), 100);
      }
    } catch (e) {
      if (!silent) setErrorMsg(messageOf(e));
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  };

  // Search users for new conversation
  const searchUsers = async (query: string) => {
    try {
      setSearchingUsers(true);
      const res = await api.get('/messages/users/search', {
        params: { q: query || undefined },
      });
      setUserSearchResults(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setUserSearchResults([]);
    } finally {
      setSearchingUsers(false);
    }
  };

  // Initial load
  useEffect(() => {
    void loadConversations();
  }, []);

  // Poll conversations & current messages every 3.5 seconds
  useEffect(() => {
    pollIntervalRef.current = window.setInterval(() => {
      void loadConversations(true);
      if (activeConvId) {
        void loadMessages(activeConvId, true);
      }
    }, 3500);

    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, [activeConvId]);

  // When active conversation changes, load its messages
  useEffect(() => {
    if (activeConvId) {
      void loadMessages(activeConvId);
    } else {
      setMessages([]);
    }
  }, [activeConvId]);

  // Handle opening user search modal
  useEffect(() => {
    if (showNewChatModal) {
      void searchUsers(userSearchQuery);
    }
  }, [showNewChatModal, userSearchQuery]);

  // Send message
  const handleSendMessage = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || !activeConvId || sending) return;

    try {
      setSending(true);
      setInputText('');
      const res = await api.post(
        `/messages/conversations/${activeConvId}/messages`,
        { messageText: text }
      );
      const createdMessage = res.data;
      setMessages((prev) => [...prev, createdMessage]);
      setTimeout(() => scrollToBottom('smooth'), 50);

      // Refresh conversations list to update last message preview
      void loadConversations(true);
    } catch (e) {
      setErrorMsg(messageOf(e));
      setInputText(text); // restore input if failed
    } finally {
      setSending(false);
    }
  };

  // Start or open conversation with a user
  const startConversationWithUser = async (targetUserId: number) => {
    try {
      setShowNewChatModal(false);
      setUserSearchQuery('');
      const res = await api.post('/messages/conversations', {
        recipientId: targetUserId,
      });
      const conv = res.data;
      if (conv?.id) {
        await loadConversations(true);
        setActiveConvId(conv.id);
      }
    } catch (e) {
      setErrorMsg(messageOf(e));
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeConvId);

  const filteredConversations = conversations.filter((c) => {
    if (!convSearch) return true;
    const term = convSearch.toLowerCase();
    return (
      c.other_user_name.toLowerCase().includes(term) ||
      c.other_user_code.toLowerCase().includes(term) ||
      (c.other_user_department &&
        c.other_user_department.toLowerCase().includes(term)) ||
      (c.last_message_text &&
        c.last_message_text.toLowerCase().includes(term))
    );
  });

  const formatMessageTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatConvTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const today = new Date();
    const isToday =
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getRoleBadgeClass = (role?: string) => {
    switch (role) {
      case 'SUPER_ADMIN':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'ADMIN':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'TEAM_LEAD':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-300';
    }
  };

  return (
    <>
      <PageTitle
        title="Internal Messages"
        subtitle="Secure, real-time messaging between employees, team leads, and administration"
        action={
          <button
            type="button"
            className="btn btn-accent flex items-center gap-2"
            onClick={() => setShowNewChatModal(true)}
          >
            <Plus size={16} />
            New Conversation
          </button>
        }
      />

      {errorMsg && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span>{errorMsg}</span>
          <button
            className="text-xs font-bold underline"
            onClick={() => setErrorMsg('')}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Messaging Window */}
      <div className="card overflow-hidden p-0 shadow-lg border border-slate-200 grid grid-cols-1 md:grid-cols-12 min-h-[640px] max-h-[780px]">
        {/* Left Panel: Conversation List */}
        <div className="md:col-span-4 lg:col-span-4 border-r border-slate-200 bg-white flex flex-col h-full">
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
                placeholder="Search conversations..."
                value={convSearch}
                onChange={(e) => setConvSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Conversation Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {loadingConvs ? (
              <div className="py-12 text-center text-sm font-semibold text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw size={16} className="animate-spin text-[#18263F]" />
                Loading conversations...
              </div>
            ) : filteredConversations.length > 0 ? (
              filteredConversations.map((conv) => {
                const isActive = conv.id === activeConvId;
                const initials = conv.other_user_name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2);

                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => setActiveConvId(conv.id)}
                    className={`w-full text-left p-4 transition-all flex items-start gap-3 relative ${
                      isActive
                        ? 'bg-[#F4EFE6] border-l-4 border-l-[#18263F]'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    {/* User Avatar */}
                    <div className="relative shrink-0">
                      {conv.other_user_photo ? (
                        <img
                          src={conv.other_user_photo}
                          alt={conv.other_user_name}
                          className="h-11 w-11 rounded-full object-cover border border-slate-200 shadow-sm"
                        />
                      ) : (
                        <div className="h-11 w-11 rounded-full bg-[#18263F] text-[#D6A94A] font-extrabold flex items-center justify-center text-sm shadow-sm">
                          {initials}
                        </div>
                      )}
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-white" />
                    </div>

                    {/* Meta & Last Message */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="font-extrabold text-sm text-[#18263F] truncate">
                          {conv.other_user_name}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-400 shrink-0">
                          {formatConvTime(conv.last_message_at || conv.created_at)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">
                          {conv.other_user_code}
                        </span>
                        {conv.other_user_department && (
                          <span className="text-[10px] text-slate-400 truncate">
                            • {conv.other_user_department}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={`text-xs truncate ${
                            conv.unread_count > 0
                              ? 'font-extrabold text-[#18263F]'
                              : 'text-slate-500'
                          }`}
                        >
                          {conv.last_message_text || 'No messages yet'}
                        </p>

                        {conv.unread_count > 0 && (
                          <span className="shrink-0 h-5 min-w-[20px] px-1.5 rounded-full bg-[#D6A94A] text-[#171717] font-extrabold text-[10px] flex items-center justify-center shadow-sm">
                            {conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="p-8 text-center text-slate-400">
                <MessageSquare size={36} className="mx-auto mb-2 opacity-40 text-slate-500" />
                <p className="text-sm font-semibold">No conversations yet</p>
                <p className="text-xs mt-1 text-slate-400">
                  Click "New Conversation" above to start chatting.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Selected Chat History & Input */}
        <div className="md:col-span-8 lg:col-span-8 bg-[#FBF9F6] flex flex-col h-full">
          {activeConversation ? (
            <>
              {/* Chat Header */}
              <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    {activeConversation.other_user_photo ? (
                      <img
                        src={activeConversation.other_user_photo}
                        alt={activeConversation.other_user_name}
                        className="h-10 w-10 rounded-full object-cover border border-slate-200"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-[#18263F] text-[#D6A94A] font-extrabold flex items-center justify-center text-sm">
                        {activeConversation.other_user_name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')
                          .toUpperCase()
                          .slice(0, 2)}
                      </div>
                    )}
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-white" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-sm text-[#18263F] truncate">
                        {activeConversation.other_user_name}
                      </h3>
                      <span
                        className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border ${getRoleBadgeClass(
                          activeConversation.other_user_role
                        )}`}
                      >
                        {activeConversation.other_user_role?.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
                      <span className="font-semibold text-slate-600">
                        {activeConversation.other_user_code}
                      </span>
                      {activeConversation.other_user_department && (
                        <span>• {activeConversation.other_user_department}</span>
                      )}
                      {activeConversation.other_user_job_title && (
                        <span>• {activeConversation.other_user_job_title}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Active
                  </span>
                </div>
              </div>

              {/* Messages Body */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
                {loadingMessages ? (
                  <div className="py-20 text-center text-sm font-semibold text-slate-400">
                    Loading messages...
                  </div>
                ) : messages.length > 0 ? (
                  messages.map((m) => {
                    const isMine = m.is_mine || m.sender_id === user?.employeeId;

                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${
                          isMine ? 'items-end' : 'items-start'
                        }`}
                      >
                        <div
                          className={`max-w-[80%] md:max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm ${
                            isMine
                              ? 'bg-[#18263F] text-white rounded-br-xs'
                              : 'bg-white text-slate-800 border border-slate-200 rounded-bl-xs'
                          }`}
                        >
                          {!isMine && (
                            <div className="text-[10px] font-extrabold text-[#B8862C] mb-1">
                              {m.sender_name} ({m.sender_code})
                            </div>
                          )}

                          <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                            {m.message_text}
                          </p>

                          <div
                            className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                              isMine ? 'text-white/60' : 'text-slate-400'
                            }`}
                          >
                            <span>{formatMessageTime(m.created_at)}</span>
                            {isMine && <CheckCheck size={12} className="text-[#D6A94A]" />}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-20 text-center text-slate-400">
                    <MessageSquare size={40} className="mx-auto mb-2 opacity-30 text-slate-500" />
                    <p className="text-sm font-bold text-slate-600">
                      No messages in this conversation yet.
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Say hello and start the discussion!
                    </p>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Input Box */}
              <form
                onSubmit={handleSendMessage}
                className="p-3 md:p-4 bg-white border-t border-slate-200 flex items-center gap-2"
              >
                <input
                  type="text"
                  className="input flex-1 py-3 px-4 text-sm bg-slate-50 rounded-xl border-slate-200 focus:bg-white transition-all"
                  placeholder="Type your message here... (Press Enter to send)"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={sending}
                />

                <button
                  type="submit"
                  disabled={!inputText.trim() || sending}
                  className="btn btn-primary flex items-center justify-center gap-2 h-11 px-5 rounded-xl transition-all shadow-md disabled:opacity-50"
                >
                  {sending ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <Send size={16} />
                  )}
                  <span className="hidden sm:inline">Send</span>
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                <MessageSquare size={32} />
              </div>
              <h3 className="font-extrabold text-base text-[#18263F]">
                Select a conversation
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                Choose an existing chat from the left panel or click "New
                Conversation" to message a colleague, team lead, or admin.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* New Conversation Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="card w-full max-w-lg p-6 bg-white shadow-2xl rounded-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div>
                <h3 className="text-lg font-extrabold text-[#18263F]">
                  Start a New Conversation
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Search active colleagues and team members across the organization
                </p>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600 font-extrabold text-lg"
                onClick={() => setShowNewChatModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="relative mb-4">
              <Search
                size={16}
                className="absolute left-3.5 top-3 text-slate-400"
              />
              <input
                type="text"
                className="input pl-10 pr-4 py-2.5 text-sm w-full rounded-xl"
                placeholder="Search by name, ID code, department or role..."
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                autoFocus
              />
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 mb-4 rounded-xl border border-slate-100">
              {searchingUsers ? (
                <div className="py-8 text-center text-xs font-semibold text-slate-400 flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin text-[#18263F]" />
                  Searching employees...
                </div>
              ) : userSearchResults.length > 0 ? (
                userSearchResults.map((usr) => (
                  <button
                    key={usr.id}
                    type="button"
                    onClick={() => startConversationWithUser(usr.id)}
                    className="w-full text-left p-3 hover:bg-slate-50 flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-[#18263F] text-[#D6A94A] font-extrabold flex items-center justify-center text-xs shrink-0">
                        {usr.first_name[0]}
                        {usr.last_name[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="font-extrabold text-sm text-[#18263F] truncate">
                          {usr.first_name} {usr.last_name}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate flex items-center gap-2">
                          <span className="font-bold">{usr.employee_code}</span>
                          {usr.department_name && (
                            <span>• {usr.department_name}</span>
                          )}
                          {usr.job_title && <span>• {usr.job_title}</span>}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border shrink-0 ${getRoleBadgeClass(
                        usr.role
                      )}`}
                    >
                      {usr.role?.replace(/_/g, ' ')}
                    </span>
                  </button>
                ))
              ) : (
                <div className="py-8 text-center text-xs text-slate-400">
                  No active employees found matching your search.
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="btn btn-secondary text-xs"
                onClick={() => setShowNewChatModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
