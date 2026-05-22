# 幂等导入策略

## 1. 策略定义

**幂等导入**：同一文件重复导入多次，结果一致（ODS 表行数不翻倍、数据不重复）。

采用 **"按 source_file_id 维度删当次导入数据 → 重灌"** 策略，实现最小复杂度幂等。

## 2. 执行流程

```
1. 计算文件 hash (SHA-256)
2. 查询 raw.ingest_file 中是否存在该 hash
   ├── 不存在 → 插入新记录，status=pending，执行导入
   └── 存在 → 检查 status
              ├── success → 执行"删除+重灌"（幂等）
              ├── pending → 等待或跳过
              └── failed → 可重试导入
3. 导入完成后更新 ingest_file.status = 'success'
```

## 3. SQL 模板

### 3.1 检查文件是否已存在

```sql
-- 根据 file_hash 检查是否已导入
SELECT id, brand_code, store_code, source_type, month, status
FROM raw.ingest_file
WHERE file_hash = :file_hash;
```

### 3.2 删除当次导入数据（幂等核心）

```sql
-- 银行流水：按 source_file_id 删除
DELETE FROM ods.bank_txn
WHERE source_file_id = :source_file_id;

-- 营业数据：按 source_file_id 删除
DELETE FROM ods.sales_daily
WHERE source_file_id = :source_file_id;
```

### 3.3 重新导入数据

```sql
-- 导入时保持 source_file_id 与 ingest_file.id 一致
INSERT INTO ods.bank_txn (
    store_code, txn_time, in_amt, out_amt, balance_amt,
    counterparty_name, summary, memo, fee_lvl1, fee_lvl2,
    source_file_id, created_at
)
SELECT
    :store_code, txn_time, in_amt, out_amt, balance_amt,
    counterparty_name, summary, memo, fee_lvl1, fee_lvl2,
    :source_file_id,  -- 关键：使用相同的 source_file_id
    CURRENT_TIMESTAMP
FROM staging_bank_txn;
```

### 3.4 更新导入状态

```sql
-- 成功时更新
UPDATE raw.ingest_file
SET status = 'success',
    row_count = :row_count,
    finished_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE id = :source_file_id;

-- 失败时更新
UPDATE raw.ingest_file
SET status = 'failed',
    error_message = :error_message,
    finished_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE id = :source_file_id;
```

## 4. Python 脚本调用示例

```python
def import_bank_txn(file_path: str, brand_code: str, store_code: str, month: str):
    # 1. 计算 hash
    file_hash = calculate_sha256(file_path)

    # 2. 检查是否已存在
    existing = db.query("SELECT id, status FROM raw.ingest_file WHERE file_hash = %s", (file_hash,))

    source_file_id = None
    if existing:
        source_file_id = existing[0]['id']
        if existing[0]['status'] == 'success':
            # 幂等：删除旧数据
            db.execute("DELETE FROM ods.bank_txn WHERE source_file_id = %s", (source_file_id,))
            log(f"已删除旧数据，source_file_id={source_file_id}")
    else:
        # 新插入
        source_file_id = db.execute("""
            INSERT INTO raw.ingest_file (brand_code, store_code, source_type, month, file_name, file_path, file_hash, status)
            VALUES (%s, %s, 'bank', %s, %s, %s, %s, 'pending')
            RETURNING id
        """, (brand_code, store_code, month, os.path.basename(file_path), file_path, file_hash))

    # 3. 执行导入（使用相同的 source_file_id）
    row_count = do_import(file_path, source_file_id)

    # 4. 更新状态
    db.execute("""
        UPDATE raw.ingest_file
        SET status = 'success', row_count = %s, finished_at = CURRENT_TIMESTAMP
        WHERE id = %s
    """, (row_count, source_file_id))
```

## 5. 验证幂等性

```sql
-- 验证：同一文件导入 2 次后，ODS 行数 = 1 次导入的行数
SELECT source_file_id, COUNT(*) AS row_count
FROM ods.bank_txn
WHERE source_file_id = :source_file_id
GROUP BY source_file_id;

-- 结果应为单行，row_count 等于实际导入行数（而非 2 倍）
```

## 6. 注意事项

1. **source_file_id 不可变**：删除旧数据后重新导入时，必须使用相同的 `source_file_id`（即 `ingest_file.id`）
2. **事务一致性**：删除和插入应在同一事务中，或确保原子性
3. **file_hash 去重**：SHA-256 保证相同文件内容必然产生相同 hash
4. **失败重跑**：失败的导入可以重新执行，逻辑相同（删当次 → 重灌）

---

## 附录：相关文件

- DDL: `sql/raw_ingest_file.sql`
- 输入规范: `inputs/README.md`
