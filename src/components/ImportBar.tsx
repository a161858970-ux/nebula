import { useState } from 'react';

export type ImportStatus = 'idle' | 'parsing' | 'done' | 'warn' | 'error';

interface ImportBarProps {
  status: ImportStatus;
  message: string;
  onImport: (url: string) => void;
}

export function ImportBar({ status, message, onImport }: ImportBarProps) {
  const [value, setValue] = useState('');

  const submit = () => onImport(value);

  return (
    <div className={`import-bar${status === 'parsing' ? ' is-parsing' : ''}`}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="粘贴 QQ音乐 / 网易云 歌单链接（留空=演示歌单）"
        spellCheck={false}
      />
      <button className="import-btn" onClick={submit} disabled={status === 'parsing'}>
        {status === 'parsing' ? '解析中…' : '导入'}
      </button>
      {message && (
        <span className={`import-status${status === 'error' ? ' is-error' : status === 'warn' ? ' is-warn' : ''}`}>
          {message}
        </span>
      )}
    </div>
  );
}
