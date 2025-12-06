import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  MessageCircle,
  X,
  Loader2,
  Sparkles,
  Database,
  ShieldCheck,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/ui/use-toast';
import apiService from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const STATUS_META = {
  idle: { label: 'Idle', className: 'bg-slate-100 text-slate-600' },
  connecting: { label: 'Connecting…', className: 'bg-amber-100 text-amber-700' },
  ready: { label: 'Connected', className: 'bg-emerald-100 text-emerald-700' },
  error: { label: 'Check API Key', className: 'bg-red-100 text-red-700' }
};

const MAX_CONTEXT_BLOCKS = 3;

const GeminiAssistant = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [connectors, setConnectors] = useState([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [activeContexts, setActiveContexts] = useState([]);
  const [contextLoadingKey, setContextLoadingKey] = useState(null);
  const [serviceStatus, setServiceStatus] = useState('idle');

  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!user) {
      setIsOpen(false);
      setMessages([]);
      setActiveContexts([]);
    } else {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: `Hi ${user.name || 'there'}! I'm your Gemini assistant. Ask me anything about your ${
            user.role || 'account'
          } data, analytics, or action items.`
        }
      ]);
    }
  }, [user]);

  useEffect(() => {
    if (isOpen && connectors.length === 0 && !connectorsLoading) {
      loadConnectors();
    }
  }, [isOpen, connectors.length, connectorsLoading]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const loadConnectors = useCallback(async () => {
    if (!user) return;
    setConnectorsLoading(true);
    try {
      const response = await apiService.getAiConnectors();
      if (response?.success) {
        setConnectors(response.data || []);
      } else {
        toast({
          variant: 'destructive',
          title: 'Unable to load data sources',
          description: response?.message || 'Please try again later.'
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Unable to load data sources',
        description: error.message || 'Please try again later.'
      });
    } finally {
      setConnectorsLoading(false);
    }
  }, [toast, user]);

  const handleContextFetch = async (connector) => {
    if (!connector) return;
    if (activeContexts.find((ctx) => ctx.key === connector.key)) {
      toast({
        title: 'Context already added',
        description: 'Remove it first if you want to refresh.'
      });
      return;
    }
    if (activeContexts.length >= MAX_CONTEXT_BLOCKS) {
      toast({
        variant: 'destructive',
        title: 'Limit reached',
        description: `You can only pin ${MAX_CONTEXT_BLOCKS} context blocks at a time.`
      });
      return;
    }

    setContextLoadingKey(connector.key);
    try {
      const response = await apiService.fetchAiContext(connector.key);
      if (!response?.success) {
        throw new Error(response?.message || 'Could not fetch context.');
      }

      const sanitized = sanitizeContextPayload(response.data);
      setActiveContexts((prev) => [
        ...prev,
        {
          key: connector.key,
          label: connector.label,
          description: connector.description,
          data: sanitized,
          raw: response.data,
          fetchedAt: new Date().toISOString()
        }
      ]);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Context fetch failed',
        description: error.message || 'Please try again.'
      });
    } finally {
      setContextLoadingKey(null);
    }
  };

  const sanitizeContextPayload = (data) => {
    try {
      const stringified = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      if (stringified.length > 4000) {
        return `${stringified.slice(0, 4000)}\n...truncated for safety...`;
      }
      return stringified;
    } catch (error) {
      return 'Unable to parse context payload.';
    }
  };

  const handleSendMessage = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || !user) return;

    const outgoingMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed
    };

    setMessages((prev) => [...prev, outgoingMessage]);
    setInputValue('');
    setIsSending(true);
    setServiceStatus('connecting');

    try {
      const historyPayload = [...messages, outgoingMessage]
        .slice(-8)
        .map(({ role, content }) => ({ role, content }));

      const contextPayload = activeContexts.map(({ key, label, data, fetchedAt }) => ({
        key,
        label,
        data,
        fetchedAt
      }));

      const response = await apiService.sendAiMessage({
        message: trimmed,
        history: historyPayload,
        context: contextPayload
      });

      if (!response?.success) {
        throw new Error(response?.message || 'Gemini could not respond.');
      }

      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response?.data?.text || 'No response generated.',
        metadata: response?.data?.metadata
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setServiceStatus('ready');
    } catch (error) {
      setServiceStatus('error');
      toast({
        variant: 'destructive',
        title: 'Gemini error',
        description: error.message || 'Please verify the Gemini API key.'
      });
    } finally {
      setIsSending(false);
    }
  };

  const removeContextBlock = (key) => {
    setActiveContexts((prev) => prev.filter((block) => block.key !== key));
  };

  const clearContexts = () => {
    setActiveContexts([]);
  };

  const statusBadge = STATUS_META[serviceStatus] || STATUS_META.idle;

  const connectorIcon = useMemo(() => {
    switch (user?.role) {
      case 'super-admin':
        return ShieldCheck;
      case 'faculty':
        return Database;
      default:
        return Sparkles;
    }
  }, [user?.role]);

  if (!user) {
    return null;
  }

  const ConnectorIcon = connectorIcon;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {isOpen && (
        <div className="w-[380px] h-[560px] rounded-3xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4 flex items-center justify-between gap-3 bg-gradient-to-r from-slate-50 to-white">
            <div>
              <p className="text-sm font-medium text-slate-800 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Gemini AI Assistant
              </p>
              <p className="text-xs text-slate-500">{user.role?.replace('-', ' ')} workspace</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn('text-[10px] font-semibold px-2 py-1 rounded-full', statusBadge.className)}>
                {statusBadge.label}
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 flex flex-col px-5 py-4 gap-3">
            <ScrollArea className="flex-1 pr-2">
              <div className="space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className="flex flex-col gap-1 text-sm">
                    <span className={cn(
                      'text-xs font-semibold',
                      message.role === 'assistant' ? 'text-indigo-600' : 'text-slate-500'
                    )}>
                      {message.role === 'assistant' ? 'Gemini' : 'You'}
                    </span>
                    <div
                      className={cn(
                        'rounded-2xl px-4 py-3 shadow-sm',
                        message.role === 'assistant'
                          ? 'bg-slate-50 text-slate-800 border border-slate-100'
                          : 'bg-indigo-600 text-white self-end'
                      )}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm max-w-none">
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="border border-slate-100 rounded-2xl p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500 flex items-center gap-2">
                  <ConnectorIcon className="h-4 w-4 text-slate-400" />
                  Data Sources
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={loadConnectors}
                  disabled={connectorsLoading}
                >
                  <RefreshCw className={cn('h-4 w-4', connectorsLoading && 'animate-spin')} />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {connectorsLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                {!connectorsLoading && connectors.length === 0 && (
                  <p className="text-xs text-slate-400">No connectors available for this role.</p>
                )}
                {connectors.map((connector) => (
                  <Button
                    key={connector.key}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => handleContextFetch(connector)}
                    disabled={contextLoadingKey === connector.key}
                  >
                    {contextLoadingKey === connector.key && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                    {connector.label}
                  </Button>
                ))}
              </div>
            </div>

            {activeContexts.length > 0 && (
              <div className="border border-slate-100 rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-500 flex items-center gap-2">
                    <Database className="h-4 w-4 text-slate-400" />
                    Pinned Context ({activeContexts.length}/{MAX_CONTEXT_BLOCKS})
                  </p>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={clearContexts}>
                    <Trash2 className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                </div>
                <div className="space-y-2 max-h-32 overflow-y-auto pr-1">
                  {activeContexts.map((block) => {
                    const preview = typeof block.raw === 'string'
                      ? block.raw
                      : JSON.stringify(block.raw, null, 2);
                    return (
                      <div key={block.key} className="border border-slate-100 rounded-xl p-2 bg-slate-50">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-600 mb-1">
                          <span>{block.label}</span>
                          <button
                            type="button"
                            className="text-slate-400 hover:text-slate-600"
                            onClick={() => removeContextBlock(block.key)}
                          >
                            ✕
                          </button>
                        </div>
                        <pre className="text-[11px] text-slate-500 whitespace-pre-wrap">
                          {preview.slice(0, 160)}
                          {preview.length > 160 && '…'}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <Textarea
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                placeholder="Ask Gemini anything related to your LMS data…"
                className="min-h-[80px] resize-none"
              />
              <div className="flex items-center justify-between mt-2">
                <p className="text-[11px] text-slate-400">
                  Gemini respects your role and only uses pinned context within your permissions.
                </p>
                <Button
                  onClick={handleSendMessage}
                  disabled={isSending || !inputValue.trim()}
                  className="rounded-full px-5"
                >
                  {isSending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending
                    </>
                  ) : (
                    <>
                      Send
                      <MessageCircle className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Button
        size="icon"
        className="h-14 w-14 rounded-full shadow-xl bg-indigo-600 hover:bg-indigo-500"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {isOpen ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </Button>
    </div>
  );
};

export default GeminiAssistant;

