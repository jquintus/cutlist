// Regression test: the results panel must actually honor a metric project.
//
// sheetSvg reads its display system off the `params` object it is handed, not
// off the plan directly, so the production call site has to fold
// plan.displaySystem into that object. Every earlier test passed plan.params
// unchanged, which never exercises a non-default displaySystem, so this was
// silently broken (the diagram stayed in inches while the printed table
// followed plan.displaySystem correctly) with nothing failing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planProject } from '../src/plan.js';
import { normalizeProject } from '../src/model.js';
import { renderResults } from '../src/ui/renderForms.js';
import { mixedPartsProject } from './fixtures/layouts.js';

test('a metric project renders its diagram dimensions in millimeters, matching the table', () => {
  const project = normalizeProject({ ...mixedPartsProject(), displaySystem: 'metric' });
  const plan = planProject(project);
  const html = renderResults(plan);

  assert.ok(html.includes(' mm<'), 'expected a millimeter-formatted dimension label in the rendered results');
  assert.ok(!html.includes(' in<'), 'no inch-formatted dimension label should remain once the project is metric');
});
