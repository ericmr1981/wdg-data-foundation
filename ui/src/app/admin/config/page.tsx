'use client';

import Link from 'next/link';

function Card({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <Link href={href} className="block bg-white border rounded p-4 hover:bg-gray-50">
      <div className="font-medium">{title}</div>
      <div className="text-sm text-gray-500 mt-1">{desc}</div>
    </Link>
  );
}

export default function AdminConfigPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Admin / 配置</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card
          title="字典管理"
          desc="维护默认分类字典，并可同步到所有品牌（支持覆盖/不覆盖模式）。"
          href="/admin/config/category-dictionary"
        />
        <Card
          title="品牌管理"
          desc="品牌列表与排序（影响选择器展示顺序）。"
          href="/admin/brands"
        />
        <Card
          title="门店管理"
          desc="门店列表与排序（影响上传/筛选选择器）。"
          href="/admin/stores"
        />
        <Card
          title="规则分组"
          desc="分组名称与排序（用于规则管理过滤/组织）。"
          href="/admin/rule-groups"
        />
      </div>
    </div>
  );
}
