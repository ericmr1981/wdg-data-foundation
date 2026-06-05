'use client';

export function UserAvatar({ role }: { role: 'user' | 'assistant' }) {
  const isUser = role === 'user';
  return (
    <div
      className={[
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        isUser ? 'bg-blue-500 text-white' : 'bg-slate-700 text-white',
      ].join(' ')}
      aria-label={isUser ? '你' : 'AI'}
    >
      {isUser ? '你' : 'AI'}
    </div>
  );
}
