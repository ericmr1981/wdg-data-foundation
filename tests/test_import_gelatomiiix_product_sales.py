import pytest
import pandas as pd
from scripts.import_gelatomiiix_product_sales import transform

def test_transform_removes_summary_row():
    raw = pd.DataFrame({
        '门店名称': ['新天地广场', '汇总：'],
        '日期': ['2026-04-01', '汇总：'],
        '订单号': ['O001', ''],
        '商品名称': ['薄荷巧克力脆脆冰', ''],
        '商品原价': ['55', ''],
        '销售数量': ['1', '30'],
        '商品销售额': ['55.00', '1650.00'],
        '商品实收': ['55.00', ''],
        '商品优惠': ['0.00', ''],
    })
    result = transform(raw)
    assert len(result) == 1
    assert result[0]['product_name'] == '薄荷巧克力脆脆冰'

def test_transform_normal_row():
    raw = pd.DataFrame({
        '门店名称': ['新天地广场'],
        '日期': ['2026-04-01'],
        '订单号': ['O001'],
        '商品名称': ['薄荷巧克力脆脆冰'],
        '商品原价': ['55'],
        '销售数量': ['1'],
        '商品销售额': ['55.00'],
        '商品实收': ['55.00'],
        '商品优惠': ['0.00'],
    })
    result = transform(raw)
    assert len(result) == 1
    assert result[0]['product_name'] == '薄荷巧克力脆脆冰'
    assert result[0]['unit_price'] == 55.0
    assert result[0]['qty'] == 1

def test_transform_empty_df():
    raw = pd.DataFrame(columns=['门店名称', '日期', '订单号', '商品名称', '商品原价', '销售数量', '商品销售额', '商品实收', '商品优惠'])
    result = transform(raw)
    assert len(result) == 0
