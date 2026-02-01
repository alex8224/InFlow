export function CodeBlock({ language, code }: { language?: string; code: string }) {
  return (
    <div className="bg-gray-900 rounded-md p-4 overflow-x-auto">
      <div className="text-gray-400 text-xs mb-2">
        {language || 'code'}
      </div>
      <pre className="text-gray-100 text-sm">
        <code>{code}</code>
      </pre>
    </div>
  );
}
