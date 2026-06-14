import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { listToolSchemas } from '../../src/mcp/server.ts';

test('NO tool accepts yufeng as a brand value', () => {
  const schemas = listToolSchemas();
  const brandTools = schemas.filter(t => {
    const props = ((t.input_schema as Record<string, unknown>).properties as Record<string, unknown>) || {};
    return 'brand' in props;
  });

  assert.ok(brandTools.length >= 10, `expected at least 10 brand-aware tools, got ${brandTools.length}`);

  for (const t of brandTools) {
    const brandProp = ((t.input_schema as Record<string, unknown>).properties as Record<string, unknown>).brand;
    if (brandProp && typeof brandProp === 'object' && 'enum' in (brandProp as Record<string, unknown>)) {
      const enumValues = (brandProp as Record<string, unknown>).enum as string[];
      assert.ok(
        !enumValues.includes('yufeng'),
        `${t.name}: brand enum must NOT include deprecated 'yufeng', got [${enumValues.join(', ')}]`
      );
    }
  }
});

test('every brand enum tool includes gelatomiiix, bonjur, tamkoko', () => {
  const schemas = listToolSchemas();
  const requiredBrands = ['gelatomiiix', 'bonjur', 'tamkoko'];

  for (const t of schemas) {
    const props = ((t.input_schema as Record<string, unknown>).properties as Record<string, unknown>) || {};
    const brandProp = props.brand;
    if (brandProp && typeof brandProp === 'object' && 'enum' in (brandProp as Record<string, unknown>)) {
      const enumValues = (brandProp as Record<string, unknown>).enum as string[];
      for (const b of requiredBrands) {
        assert.ok(enumValues.includes(b), `${t.name}: brand enum must include '${b}'`);
      }
    }
  }
});

test('no tool uses z.string() for brand — all must use enum', () => {
  const schemas = listToolSchemas();
  for (const t of schemas) {
    const props = ((t.input_schema as Record<string, unknown>).properties as Record<string, unknown>) || {};
    const brandProp = props.brand;
    if (brandProp && typeof brandProp === 'object' && (brandProp as Record<string, unknown>).type === 'string') {
      assert.ok(
        'enum' in (brandProp as Record<string, unknown>),
        `${t.name}: brand should use enum not z.string(). Switch to brandParamSchema.`
      );
    }
  }
});
