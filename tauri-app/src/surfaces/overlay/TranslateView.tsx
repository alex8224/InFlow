import { useState, useEffect, useRef } from 'react';
import { Copy, RotateCcw, Settings, ArrowRight, Command, Globe, Languages, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '../../components/ui/select';
import { translateText, saveApiKey, getApiKeyStatus } from '../../integrations/tauri/api';
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
  const [apiKey, setApiKey] = useState('');
  const [inputText, setInputText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [fromLang, setFromLang] = useState('auto');
  const [toLang, setToLang] = useState('zh-CN');
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const status = await getApiKeyStatus();
        setHasApiKey(status.hasKey);
      } catch (e) {
        console.error('Failed to check API key status:', e);
      }
    };
    checkStatus();
  }, []);

  // Handle Incoming Invocation Context
  useEffect(() => {
    if (currentInvocation?.capabilityId === 'translate.selection' || currentInvocation?.capabilityId === 'translate.text') {
      const text = currentInvocation.context?.selectedText;
      if (text && text !== inputText) {
        setInputText(text);
        // Auto trigger translation if input changed via invocation
        setTimeout(() => handleTranslateInternal(text, fromLang, toLang), 100);
      }
    }
  }, [currentInvocation]);

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      setError('请输入 API Key');
      return;
    }
    try {
      const success = await saveApiKey(apiKey.trim());
      if (success) {
        setHasApiKey(true);
        setError('');
      } else {
        setError('保存失败');
      }
    } catch (e) {
      setError('保存失败');
    }
  };

  const handleTranslateInternal = async (text: string, from: string, to: string) => {
    if (!text.trim()) return;
    setError('');
    setIsTranslating(true);
    try {
      const result = await translateText(text.trim(), from, to);
      setTranslatedText(result.translatedText);
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

  if (!hasApiKey) {
    return (
      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="space-y-4 text-center">
          <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center mx-auto shadow-sm text-blue-600 dark:text-blue-400">
            <Settings className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">设置 API 密钥</h2>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="粘贴您的 API Key..."
            className="bg-background border-input"
          />
          {error && <p className="text-xs text-destructive font-medium">{error}</p>}
          <Button onClick={handleSaveApiKey} className="w-full font-bold h-10 shadow-lg shadow-primary/20 active:scale-[0.98] transition-all">
            保存并开始
          </Button>
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline inline-block pt-2"
          >
            获取密钥 →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-300">
      {/* Input Area - Fixed Height 140px */}
      <div className="h-[140px] shrink-0 mb-3 relative group">
        <Textarea
          ref={inputRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="在此输入文本..."
          className="w-full h-full resize-none text-base bg-muted/20 border-border p-4 shadow-inner rounded-xl focus-visible:ring-2 focus-visible:ring-primary/20 transition-all select-text leading-relaxed"
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-1 text-[10px] text-muted-foreground font-black pointer-events-none opacity-0 group-focus-within:opacity-40 transition-opacity uppercase">
          <div className="px-1.5 py-0.5 border border-border rounded shadow-sm bg-background">Ctrl</div>
          <span>+</span>
          <div className="px-1.5 py-0.5 border border-border rounded shadow-sm bg-background">Enter</div>
        </div>
      </div>

      {/* Controls - Fixed Height 50px */}
      <div className="h-[50px] shrink-0 flex items-center justify-between bg-muted/30 p-1.5 rounded-xl border border-border/50 shadow-sm mb-3">
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

      {/* Fixed error spacer - 20px */}
      <div className="h-5 shrink-0 -mt-2 mb-1 overflow-hidden">
        {error && (
          <p className="text-[10px] text-destructive font-bold text-center uppercase tracking-tight animate-in slide-in-from-top-1">
            {error}
          </p>
        )}
      </div>

      {/* Result Area - Flexible */}
      <div className={cn(
        "flex-1 min-h-0 border rounded-2xl p-4 bg-background overflow-auto relative group transition-all duration-300 shadow-sm",
        translatedText ? "border-primary/30 ring-1 ring-primary/10" : "border-dashed border-border"
      )}>
        {translatedText ? (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 opacity-40">
                <Command className="w-3 h-3 text-primary" />
                <span className="text-[10px] uppercase tracking-widest font-black text-primary">Result</span>
              </div>
              <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all scale-95 group-hover:scale-100">
                <Button 
                  onClick={handleCopy} 
                  variant="secondary" 
                  size="icon" 
                  className="h-8 w-8 rounded-lg bg-muted border border-border shadow-sm hover:scale-110 transition-all active:scale-90"
                  title="复制译文"
                >
                  <Copy className="w-4 h-4" />
                </Button>
                <Button 
                  onClick={handleClear} 
                  variant="secondary" 
                  size="icon" 
                  className="h-8 w-8 rounded-lg bg-muted border border-border shadow-sm hover:scale-110 transition-all active:scale-90 text-destructive hover:text-destructive"
                  title="清除"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <p className="text-foreground text-[15px] leading-relaxed font-medium pr-2 select-text selection:bg-primary/20">
              {translatedText}
            </p>
          </div>
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
