export function DailyCheckErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 mb-4 text-sm">
      <div className="font-medium">DailyCheck 物料看板暂不可用</div>
      <div className="text-xs mt-1">{message}</div>
      <div className="text-xs mt-1 text-red-600">
        月度录入与历史盘点记录仍可正常查看与编辑。
      </div>
    </div>
  );
}
