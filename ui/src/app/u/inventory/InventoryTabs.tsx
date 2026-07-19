import Link from 'next/link';

interface Brand { code: 'tamkoko' | 'gelatomiiix'; label: string; }

export function InventoryTabs({ current }: { current: Brand['code'] }) {
  const brands: Brand[] = [
    { code: 'tamkoko', label: '泰柯茶园 (tamkoko)' },
    { code: 'gelatomiiix', label: '蜜可诗 (gelatomiiix)' },
  ];
  return (
    <nav className="border-b mb-4 flex gap-2 text-sm">
      {brands.map((b) => (
        <Link
          key={b.code}
          href={`/u/inventory?brand=${b.code}`}
          className={
            'px-3 py-2 -mb-px border-b-2 ' +
            (b.code === current
              ? 'border-blue-600 text-blue-700 font-medium'
              : 'border-transparent text-gray-500 hover:text-gray-700')
          }
        >
          {b.label}
        </Link>
      ))}
    </nav>
  );
}
