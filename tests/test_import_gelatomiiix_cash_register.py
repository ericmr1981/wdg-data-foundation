import pytest
from scripts.import_gelatomiiix_cash_register import extract_payment_method

def test_extract_payment_method():
    row = {
        '云闪付': '', '免支付': '', '微信支付': '35.00',
        '抖音团购券': '', '支付宝支付': '', '现金支付': '',
        '美团团购券': '', '自定义结账方式': ''
    }
    assert extract_payment_method(row) == '微信支付'

def test_extract_payment_method_none():
    row = {k: '' for k in ['云闪付','免支付','微信支付','抖音团购券','支付宝支付','现金支付','美团团购券','自定义结账方式']}
    assert extract_payment_method(row) is None

def test_extract_payment_method_multiple():
    """Should return the first non-empty payment method found."""
    row = {
        '云闪付': '', '免支付': '', '微信支付': '35.00',
        '抖音团购券': '', '支付宝支付': '', '现金支付': '',
        '美团团购券': '10.00', '自定义结账方式': ''
    }
    assert extract_payment_method(row) == '微信支付'
