import { useState, useEffect } from 'react';
import { 
  Save, 
  RefreshCw, 
  Cpu, 
  Globe, 
  Key, 
  Link as LinkIcon, 
  Box, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Settings2,
  ExternalLink,
  ShieldCheck,
  X,
  Sparkles
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { getAppConfig, updateAppConfig, AppConfig, LlmProvider } from '../../integrations/tauri/api';
import { cn } from '../../lib/cn';

const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', kind: 'OpenAI', baseUrl: 'https://api.deepseek.com/v1', modelId: 'deepseek-chat', icon: 'D' },
  { id: 'siliconflow', name: '硅基流动', kind: 'OpenAI', baseUrl: 'https://api.siliconflow.cn/v1', modelId: 'deepseek-ai/DeepSeek-V3', icon: 'S' },
  { id: 'volcengine', name: '火山引擎', kind: 'OpenAI', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', modelId: 'ep-...', icon: 'V' },
  { id: 'minimax', name: 'Minimax', kind: 'OpenAI', baseUrl: 'https://api.minimax.chat/v1', modelId: 'abab6.5-chat', icon: 'M' },
  { id: 'gemini', name: 'Google Gemini', kind: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com', modelId: 'gemini-2.0-flash', icon: 'G' },
  { id: 'openai', name: 'OpenAI', kind: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o-mini', icon: 'O' },
];

const DEFAULT_URLS: Record<string, string> = {
  'OpenAI': 'https://api.openai.com/v1',
  'Gemini': 'https://generativelanguage.googleapis.com',
};

export function SettingsView() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [message, setMessage] = useState({ text: '', type: 'info' });

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const data = await getAppConfig();
      setConfig(data);
      if (data.llmProviders.length > 0) {
        setSelectedId(data.activeProviderId || data.llmProviders[0].id);
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (updatedConfig?: AppConfig) => {
    const configToSave = updatedConfig || config;
    if (!configToSave) return;
    setSaving(true);
    try {
      await updateAppConfig(configToSave);
      setMessage({ text: '配置已保存', type: 'success' });
      setTimeout(() => setMessage({ text: '', type: 'info' }), 3000);
    } catch (err: any) {
      setMessage({ text: `保存失败: ${err}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const updateSelectedProvider = (updates: Partial<LlmProvider>) => {
    if (!config || !selectedId) return;
    const newProviders = config.llmProviders.map(p => 
      p.id === selectedId ? { ...p, ...updates } : p
    );
    setConfig({ ...config, llmProviders: newProviders });
  };

  const addFromPreset = (preset: typeof PRESETS[0]) => {
    if (!config) return;
    const newId = `${preset.id}-${Date.now()}`;
    const newProvider: LlmProvider = {
      id: newId,
      name: preset.name,
      kind: preset.kind,
      baseUrl: preset.baseUrl,
      apiKey: '',
      modelId: preset.modelId
    };
    const newConfig = {
        ...config,
        llmProviders: [...config.llmProviders, newProvider]
    };
    setConfig(newConfig);
    setSelectedId(newId);
    setShowPresets(false);
  };

  const deleteProvider = (id: string) => {
    if (!config) return;
    const newProviders = config.llmProviders.filter(p => p.id !== id);
    let newActiveId = config.activeProviderId;
    if (newActiveId === id) {
        newActiveId = newProviders[0]?.id || null;
    }
    const newConfig = { ...config, llmProviders: newProviders, activeProviderId: newActiveId };
    setConfig(newConfig);
    if (selectedId === id) {
      setSelectedId(newProviders[0]?.id || null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config) return null;

  const selectedProvider = config.llmProviders.find(p => p.id === selectedId);

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">系统设置</h1>
          <p className="text-muted-foreground mt-1 text-sm">管理 AI 模型及其接入协议</p>
        </div>
        <div className="flex items-center gap-3">
          {message.text && (
            <span className={cn(
              "text-xs font-bold px-3 py-1.5 rounded-full animate-in zoom-in",
              message.type === 'success' ? "bg-green-500/10 text-green-600" : "bg-destructive/10 text-destructive"
            )}>
              {message.text}
            </span>
          )}
          <Button onClick={() => handleSave()} disabled={saving} size="sm" className="font-bold shadow-lg shadow-primary/20 px-6">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            保存配置
          </Button>
        </div>
      </div>

      <div className="flex-1 flex gap-8 min-h-0">
        <aside className="w-72 flex flex-col gap-4 shrink-0">
          <Card className="flex-1 flex flex-col overflow-hidden shadow-sm border-border/50 bg-background">
            <CardHeader className="p-4 border-b bg-muted/20 flex flex-row items-center justify-between space-y-0 shrink-0">
                <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">模型提供商</CardTitle>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg hover:bg-primary/10 hover:text-primary" onClick={() => setShowPresets(true)}>
                  <Plus className="w-4 h-4" />
                </Button>
            </CardHeader>
            <div className="flex-1 overflow-auto p-2 space-y-1 bg-muted/5">
              {config.llmProviders.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all group relative",
                    selectedId === p.id 
                      ? "bg-primary text-primary-foreground shadow-md" 
                      : "hover:bg-muted/50 text-foreground"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs shrink-0",
                    selectedId === p.id ? "bg-white/20" : "bg-muted"
                  )}>
                    {p.name[0]}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="font-bold text-sm truncate">{p.name}</div>
                    <div className={cn(
                      "text-[9px] truncate opacity-60 font-medium uppercase tracking-tighter",
                      selectedId === p.id ? "text-primary-foreground" : "text-muted-foreground"
                    )}>
                      {p.kind} • {p.modelId}
                    </div>
                  </div>
                  {config.activeProviderId === p.id && (
                    <CheckCircle2 className={cn("w-3.5 h-3.5 shrink-0", selectedId === p.id ? "text-white" : "text-green-500")} />
                  )}
                </button>
              ))}
            </div>
          </Card>

          <Card className="shadow-sm border-border/50 overflow-hidden shrink-0 bg-background">
            <div className="p-4 flex flex-col gap-3 bg-muted/5">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">翻译引擎偏好</span>
                <div className="flex bg-muted rounded-xl p-1 border shadow-inner">
                    <button 
                        onClick={() => {
                            const newConfig = {...config, preferredService: 'google'};
                            setConfig(newConfig);
                            handleSave(newConfig);
                        }}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all", 
                            config.preferredService === 'google' ? "bg-background shadow-sm text-foreground" : "opacity-40 hover:opacity-70 text-foreground"
                        )}
                    >
                        <Globe className="w-3.5 h-3.5" />
                        Google
                    </button>
                    <button 
                        onClick={() => {
                            const newConfig = {...config, preferredService: 'ai'};
                            setConfig(newConfig);
                            handleSave(newConfig);
                        }}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all", 
                            config.preferredService === 'ai' ? "bg-background shadow-sm text-blue-500" : "opacity-40 hover:opacity-70 text-foreground"
                        )}
                    >
                        <Sparkles className="w-3.5 h-3.5" />
                        AI 深度
                    </button>
                </div>
            </div>
          </Card>
        </aside>

        <main className="flex-1 min-w-0 overflow-auto pr-2">
          {selectedProvider ? (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300 pb-12">
              <div className="flex items-center justify-between bg-muted/10 p-6 rounded-[2rem] border border-border/50 shadow-sm bg-background">
                <div className="flex items-center gap-5">
                  <div className="w-16 h-16 bg-primary text-primary-foreground rounded-2xl flex items-center justify-center font-black text-2xl shadow-xl shadow-primary/20">
                    {selectedProvider.name[0]}
                  </div>
                  <div className="text-left">
                    <h2 className="text-2xl font-bold tracking-tight text-foreground">{selectedProvider.name}</h2>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-black uppercase tracking-widest">{selectedProvider.kind}</span>
                        <span className="text-[10px] text-muted-foreground font-medium truncate max-w-[200px] opacity-60">{selectedProvider.modelId}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                   <Button 
                    variant={config.activeProviderId === selectedId ? "default" : "outline"}
                    size="sm"
                    className="font-bold rounded-xl h-10 px-6 shadow-sm"
                    onClick={() => {
                        const newConfig = {...config, activeProviderId: selectedId};
                        setConfig(newConfig);
                        handleSave(newConfig);
                    }}
                   >
                    {config.activeProviderId === selectedId ? "当前默认" : "设为默认"}
                   </Button>
                   <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-destructive hover:bg-destructive/10 transition-colors" onClick={() => deleteProvider(selectedId!)}>
                     <Trash2 className="w-4.5 h-4.5" />
                   </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 px-2">
                 <div className="space-y-2.5 text-left">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground px-1">显示名称</label>
                    <Input 
                      value={selectedProvider.name}
                      onChange={(e) => updateSelectedProvider({ name: e.target.value })}
                      placeholder="例如: DeepSeek 翻译"
                      className="bg-muted/20 font-bold h-12 rounded-xl border-border/50 focus:bg-background transition-all px-4 text-foreground"
                    />
                 </div>
                 <div className="space-y-2.5 text-left">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground px-1">协议类型</label>
                    <div className="flex bg-muted/30 rounded-xl p-1 border border-border/50 h-12 items-center shadow-inner">
                        <button 
                            className={cn(
                                "flex-1 h-10 rounded-lg text-xs font-black transition-all",
                                selectedProvider.kind === 'OpenAI' ? "bg-background shadow-sm text-foreground" : "opacity-40 hover:opacity-60 text-foreground"
                            )}
                            onClick={() => updateSelectedProvider({ kind: 'OpenAI' })}
                        >OpenAI 兼容</button>
                        <button 
                            className={cn(
                                "flex-1 h-10 rounded-lg text-xs font-black transition-all",
                                selectedProvider.kind === 'Gemini' ? "bg-background shadow-sm text-foreground" : "opacity-40 hover:opacity-60 text-foreground"
                            )}
                            onClick={() => updateSelectedProvider({ kind: 'Gemini' })}
                        >Google Gemini</button>
                    </div>
                 </div>

                 <div className="md:col-span-2 space-y-2.5 text-left">
                     <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground px-1 flex items-center gap-2">
                         <LinkIcon className="w-3 h-3" />
                         Base URL
                     </label>
                     <div className="relative group/url">
                        <Input 
                        value={selectedProvider.baseUrl || ''}
                        onChange={(e) => updateSelectedProvider({ baseUrl: e.target.value })}
                        placeholder={DEFAULT_URLS[selectedProvider.kind] || "请输入 API 地址"}
                        className="bg-muted/20 h-12 rounded-xl border-border/50 focus:bg-background transition-all px-4 font-mono text-sm text-foreground pr-24"
                        />
                         {(!selectedProvider.baseUrl || selectedProvider.baseUrl !== DEFAULT_URLS[selectedProvider.kind]) && DEFAULT_URLS[selectedProvider.kind] && (
                            <button 
                                onClick={() => updateSelectedProvider({ baseUrl: DEFAULT_URLS[selectedProvider.kind] })}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] bg-primary/10 hover:bg-primary/20 text-primary px-2 py-1 rounded-md font-bold transition-all"
                            >
                                使用默认值
                            </button>
                        )}
                     </div>
                     {DEFAULT_URLS[selectedProvider.kind] && (
                        <p className="text-[9px] text-muted-foreground/50 mt-1 px-1 flex items-center gap-1">
                            官方默认: <code className="bg-muted px-1 rounded">{DEFAULT_URLS[selectedProvider.kind]}</code>
                        </p>
                     )}
                  </div>

                  <div className="space-y-2.5 text-left">
                     <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground px-1 flex items-center gap-2">
                         <Box className="w-3 h-3" />
                         Model ID
                     </label>
                     <Input 
                       value={selectedProvider.modelId}
                       onChange={(e) => updateSelectedProvider({ modelId: e.target.value })}
                       placeholder="例如: gpt-4o 或 deepseek-chat"
                       className="bg-muted/20 h-12 rounded-xl border-border/50 focus:bg-background transition-all px-4 font-mono text-sm text-foreground"
                     />
                     <p className="text-[9px] text-muted-foreground/50 mt-1 px-1">
                        实际发送: <code className="bg-primary/5 text-primary/70 px-1 rounded font-bold">
                            {selectedProvider.modelId.startsWith('/') ? selectedProvider.modelId.slice(1) : (selectedProvider.modelId.includes('/') ? selectedProvider.modelId : `${selectedProvider.kind.toLowerCase()}/${selectedProvider.modelId}`)}
                        </code>
                        <span className="ml-2">(输入 / 开头可禁用前缀)</span>
                     </p>
                  </div>


                 <div className="space-y-2.5 text-left">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground px-1 flex items-center gap-2">
                        <ShieldCheck className="w-3 h-3" />
                        API Key
                    </label>
                    <Input 
                      type="password"
                      value={selectedProvider.apiKey}
                      onChange={(e) => updateSelectedProvider({ apiKey: e.target.value })}
                      placeholder="在此粘贴您的密钥"
                      className="bg-muted/20 h-12 rounded-xl border-border/50 focus:bg-background transition-all px-4 text-foreground"
                    />
                 </div>
              </div>

              <div className="pt-10">
                  <div className="bg-muted/20 rounded-[2rem] p-8 border border-dashed border-border/60 flex flex-col items-center justify-center gap-4">
                      <Settings2 className="w-10 h-10 text-muted-foreground/20" />
                      <div className="text-center space-y-1">
                          <p className="text-sm font-bold text-foreground">该供应商将作为系统默认 AI 引擎</p>
                          <p className="text-xs text-muted-foreground max-w-[320px]">用于流式翻译、文档总结及未来所有 AI 增强功能。</p>
                          <div className="pt-4 flex justify-center">
                            <a href="#" className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline inline-flex items-center gap-1.5 font-bold">
                               查看配置指南 <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                      </div>
                  </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-6 opacity-20">
               <div className="p-10 bg-muted/50 rounded-full shadow-inner">
                <Cpu className="w-20 h-20" />
               </div>
               <p className="font-black uppercase tracking-[0.5em] text-lg">Select a Provider</p>
            </div>
          )}
        </main>
      </div>

      {showPresets && (
        <div className="fixed inset-0 bg-background/60 backdrop-blur-md z-[100] flex items-center justify-center p-8 animate-in fade-in duration-300">
           <Card className="w-full max-w-2xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.4)] rounded-[2.5rem] overflow-hidden border-border/40 bg-background text-foreground">
              <CardHeader className="p-10 pb-6 text-left">
                  <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-3xl font-black tracking-tight">添加模型提供商</CardTitle>
                        <p className="text-muted-foreground text-sm mt-2 font-medium">选择预设模板一键配置，或从头开始</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-muted" onClick={() => setShowPresets(false)}>
                        <X className="w-6 h-6" />
                    </Button>
                  </div>
              </CardHeader>
              <CardContent className="p-10 pt-0">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-5 py-6">
                      {PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => addFromPreset(preset)}
                          className="flex flex-col items-center gap-4 p-6 rounded-[2rem] border border-border/50 bg-muted/20 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all hover:scale-105 active:scale-95 group shadow-sm hover:shadow-xl hover:shadow-primary/20"
                        >
                          <div className="w-14 h-14 bg-background rounded-2xl flex items-center justify-center font-black text-2xl shadow-inner group-hover:bg-white/20 transition-colors text-foreground group-hover:text-inherit">
                            {preset.icon}
                          </div>
                          <span className="font-bold text-sm tracking-tight text-foreground group-hover:text-inherit">{preset.name}</span>
                        </button>
                      ))}
                  </div>
                  <div className="mt-4 pt-6 border-t border-border/40 text-center">
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">所有提供商均支持 OpenAI 兼容协议或 Google 官方协议</p>
                  </div>
              </CardContent>
           </Card>
        </div>
      )}
    </div>
  );
}
