import { useState, useEffect, useRef } from 'react';
import { Copy, RotateCcw, Settings, ArrowRight, Command, Globe, Languages, Sparkles, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { listen } from '@tauri-apps/api/event';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '../../components/ui/select';
import { translateText, translateTextAiStream, getAppConfig, AppConfig, getClipboardText } from '../../integrations/tauri/api';
import { cn } from '../../lib/cn';
import { useInvocationStore } from '../../stores/invocationStore';

const LANGUAGES = [
  { code: 'auto', name: '自动检测' },
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: '中文 (简体)' },
  { code: 'zh-TW', name: '中文 (繁体)' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'ru', name: 'Русский' },
];

export function TranslateView() {
  const currentInvocation = useInvocationStore((state) => state.currentInvocation);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [inputText, setInputText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [fromLang, setFromLang] = useState('auto');
  const [toLang, setToLang] = useState('zh-CN');
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState('');
  const [activeService, setActiveService] = useState<'google' | 'ai'>('google');

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConfig();
    
    // Listen for AI streaming tokens
    const unlistenToken = listen<string>('translation-token', (event) => {
      setTranslatedText((prev) => prev + event.payload);
      // Auto-scroll to bottom
      if (resultRef.current) {
        resultRef.current.scrollTop = resultRef.current.scrollHeight;
      }
    });

    // Listen for config changes from other windows (e.g. Workspace)
    const unlistenConfig = listen<AppConfig>('app-config-changed', (event) => {
      console.log('Config updated from other window:', event.payload);
      setConfig(event.payload);
      setActiveService(event.payload.preferredService as 'google' | 'ai');
    });

    return () => {
      unlistenToken.then(f => f());
      unlistenConfig.then(f => f());
    };
  }, []);

  const loadConfig = async () => {
    try {
      const data = await getAppConfig();
      setConfig(data);
      setActiveService(data.preferredService as 'google' | 'ai');
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  };

  // Handle Incoming Invocation Context
  useEffect(() => {
    const handleInvocation = async () => {
      if (currentInvocation?.capabilityId === 'translate.selection' || currentInvocation?.capabilityId === 'translate.text') {
        let text = currentInvocation.context?.selectedText;
        
        // 大文本优化：如果链接参数中没有文本，则尝试从剪贴板读取
        if (!text || text.trim() === "") {
          try {
            text = await getClipboardText();
            console.log('Using clipboard text as fallback for large content');
          } catch (err) {
            console.error('Failed to read fallback clipboard text:', err);
          }
        }

        if (text && text !== inputText) {
          setInputText(text);
          // Wait for config to load before auto-triggering
          if (config) {
              handleTranslateInternal(text, fromLang, toLang);
          }
        }
      }
    };

    handleInvocation();
  }, [currentInvocation, config]);

  const handleTranslateInternal = async (text: string, from: string, to: string) => {
    if (!text.trim()) return;
    setError('');
    setIsTranslating(true);
    setTranslatedText(''); // Reset for new translation

    try {
      if (activeService === 'ai') {
        await translateTextAiStream(text.trim(), from, to);
      } else {
        const result = await translateText(text.trim(), from, to);
        setTranslatedText(result.translatedText);
      }
    } catch (e: any) {
      setError(e.message || '翻译失败');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleTranslate = () => handleTranslateInternal(inputText, fromLang, toLang);

  const handleCopy = async () => {
    if (translatedText) {
      await navigator.clipboard.writeText(translatedText);
    }
  };

  const handleClear = () => {
    setInputText('');
    setTranslatedText('');
    setError('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleTranslate();
    }
  };

  const currentProvider = config?.llmProviders.find(p => p.id === config.activeProviderId);

  return (
    <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-300">
      
      {/* Service Selector Toggle */}
      <div className="flex bg-muted/40 p-1 rounded-xl border border-border/50 mb-3 shrink-0 self-center">
        <button
          onClick={() => setActiveService('google')}
          className={cn(
            "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
            activeService === 'google' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Zap className={cn("w-3.5 h-3.5", activeService === 'google' ? "text-yellow-500 fill-yellow-500" : "")} />
          Google 极速
        </button>
        <button
          onClick={() => setActiveService('ai')}
          className={cn(
            "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
            activeService === 'ai' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Sparkles className={cn("w-3.5 h-3.5", activeService === 'ai' ? "text-blue-500 fill-blue-500" : "")} />
          AI 深度 {currentProvider && <span className="opacity-40 text-[10px]">({currentProvider.name})</span>}
        </button>
      </div>

      {/* Input Area - Fixed Height 140px */}
      <div className="h-[130px] shrink-0 mb-3 relative group">
        <Textarea
          ref={inputRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="在此输入文本..."
          className="w-full h-full resize-none text-base bg-muted/10 border-border p-4 shadow-inner rounded-2xl focus-visible:ring-2 focus-visible:ring-primary/20 transition-all select-text leading-relaxed"
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-1 text-[10px] text-muted-foreground font-black pointer-events-none opacity-0 group-focus-within:opacity-40 transition-opacity uppercase">
          <div className="px-1 py-0.5 border border-border rounded shadow-sm bg-background">Ctrl</div>
          <span>+</span>
          <div className="px-1 py-0.5 border border-border rounded shadow-sm bg-background">Enter</div>
        </div>
      </div>

      {/* Controls - Fixed Height 50px */}
      <div className="h-[50px] shrink-0 flex items-center justify-between bg-muted/20 p-1.5 rounded-2xl border border-border/50 mb-3">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Select value={fromLang} onValueChange={setFromLang}>
            <SelectTrigger className="h-8 rounded-lg bg-background border-border shadow-sm text-[11px] font-bold hover:border-primary/50 transition-all flex-1 min-w-[100px]">
              <div className="flex items-center gap-2 truncate">
                <Languages className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 mx-0.5 shrink-0" />
          
          <Select value={toLang} onValueChange={setToLang}>
            <SelectTrigger className="h-8 rounded-lg bg-background border-border shadow-sm text-[11px] font-bold hover:border-primary/50 transition-all flex-1 min-w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.filter(l => l.code !== 'auto').map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleTranslate}
          disabled={isTranslating || !inputText.trim()}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-0 h-8 w-24 rounded-lg shadow-lg shadow-primary/20 active:scale-95 transition-all ml-2 shrink-0"
        >
          {isTranslating ? (
            <div className="flex items-center justify-center">
              <div className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <Sparkles className="w-3.5 h-3.5" />
              <span>翻译</span>
            </div>
          )}
        </Button>
      </div>

      {/* Fixed error spacer */}
      <div className="h-5 shrink-0 -mt-2 mb-1 overflow-hidden">
        {error && (
          <p className="text-[10px] text-destructive font-bold text-center uppercase tracking-tight animate-in slide-in-from-top-1">
            {error}
          </p>
        )}
      </div>

      {/* Result Area - Markdown Support */}
      <div 
        className={cn(
            "flex-1 min-h-0 border rounded-2xl bg-background relative group transition-all duration-300 shadow-sm overflow-hidden",
            translatedText ? "border-primary/30 ring-1 ring-primary/10" : "border-dashed border-border"
        )}
      >
        {translatedText ? (
          <>
            {/* Absolute Toolbar */}
            <div className="absolute top-2 left-4 right-2 flex items-center justify-between z-20 pointer-events-none">
              <div className="flex items-center gap-1.5 opacity-20 transition-opacity group-hover:opacity-40">
                <span className="text-[9px] uppercase tracking-[0.2em] font-black text-primary">Result</span>
              </div>
              <div className="flex gap-1 pointer-events-auto opacity-0 group-hover:opacity-100 transition-all scale-95 group-hover:scale-100 translate-x-1 group-hover:translate-x-0">
                <Button 
                  onClick={handleCopy} 
                  variant="ghost" 
                  size="icon" 
                  className="h-7 w-7 rounded-lg bg-background/50 backdrop-blur-md border border-border/50 shadow-sm hover:bg-background hover:scale-105 transition-all"
                  title="复制译文"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                <Button 
                  onClick={handleClear} 
                  variant="ghost" 
                  size="icon" 
                  className="h-7 w-7 rounded-lg bg-background/50 backdrop-blur-md border border-border/50 shadow-sm hover:bg-background hover:scale-105 transition-all text-destructive hover:text-destructive"
                  title="清除"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Scrollable Content Area */}
            <div 
              ref={resultRef}
              className="h-full w-full overflow-auto p-4 pt-9 custom-scrollbar"
            >
              <div className="animate-in fade-in slide-in-from-top-1">
                <div className="prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed font-medium selection:bg-primary/20">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {translatedText}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground/30 gap-3 opacity-50 transition-opacity group-hover:opacity-100">
            <div className="p-4 bg-muted/50 rounded-full shadow-inner">
              <Globe className="w-8 h-8 opacity-20" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em]">Ready to translate</p>
          </div>
        )}
      </div>
    </div>
  );
}
