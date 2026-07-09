# SDK Upgrade Notes — 2026-07-10

## 升级
- from: @anthropic-ai/sdk ^0.30.0
- to:   @anthropic-ai/sdk ^0.110.0 (实际 0.110.0)

Verified at:
- `agent/package.json`: `"@anthropic-ai/sdk": "^0.110.0"`
- `agent/node_modules/@anthropic-ai/sdk/package.json`: `"version": "0.110.0"`

## npm install warnings
无警告 / 无错误。`npm install @anthropic-ai/sdk@^0.110` 输出:
```
added 6 packages, removed 23 packages, and changed 1 package in 1s
34 packages are looking for funding
  run `npm fund` for details
```

- 无 peer dep 冲突
- 无 deprecation 警告
- 未使用 --legacy-peer-deps

## API 验证(Step 2)

`RateLimitError` 导出:`node -e "import('@anthropic-ai/sdk').then(m => console.log(typeof m.RateLimitError))"` → `function`(稳定 typed exception)

`messages.toolRunner` 存在于 `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts`:
```ts
toolRunner(body: BetaToolRunnerParams & { ... }): ...
toolRunner(body: BetaToolRunnerParams, options?): BetaToolRunner<boolean>;
```

## 测试失败数(Step 3)
**0 个失败。33 个测试全部通过**(`# tests 33 / # pass 33 / # fail 0`)。

完整 TAP 汇总(`node --import tsx --test --test-force-exit 'src/**/*.test.ts'`):
```
# tests 33
# suites 0
# pass 33
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1682.586
```

### 与 brief 预期的偏差
Brief 原本预期"大量失败(`temperature` / `budget_tokens` 不识别,thinking config 形状对不上)"。实际为 0 失败,原因:

- 测试套件通过 `MockAnthropic` / `MockMcpBridge` 隔离 SDK,见 `agent/test/helpers/`
  - `src/agent/runner.test.ts` 使用 `MockAnthropic`
  - `src/tasks/scheduler.test.ts` 使用 `MockMcpBridge`
- 没有测试真正调用 SDK 的 `messages.create`,所以 SDK 类型签名变化不会触发运行时失败
- `config/store.test.ts` 测试的是 agent 内部的 helper(`thinkingConfigFor` 等),不是 SDK 行为
- `temperature: 0.3` / `budget_tokens: 8192` 是 **agent 自己 config 对象** 的字段,直接对比 helper 输出,不进 SDK

### 关于 `npm test` 本身
默认 `npm test`(`node --import tsx --test 'src/**/*.test.ts'`)存在 **与 SDK 升级无关的 pre-existing hang**:
- `scheduler.test.ts` 启动 `TaskScheduler.start()`,其 `workerLoop()` 是 `while(true)` 无限循环
- 没有 `stop()` / `afterEach` 清理,Node 永远不会 exit
- 命令在 33/33 测试通过后阻塞在 event loop,需要 `pkill -9` 才能结束
- 用 `node --import tsx --test --test-force-exit ...` 可绕过 hang 并看到 TAP 汇总(33/33 pass)
- 修复 scheduler 关闭是 R4 范畴(R2/R4 不属于本次任务),这里仅记录现象

## 后续 batch 修复
- R2 修 thinking config 实际 shape(`{ type: 'adaptive' }` 取代 `{ type: 'enabled', budget_tokens: N }`)— 由于测试当前 100% mock,实际改的将是 source code 而非测试
- R4 修 runner,改用 `messages.toolRunner`
- 顺便:`scheduler.test.ts` 的 test fixture 缺清理,加 `await scheduler.stop()` 在 `after()` 里
