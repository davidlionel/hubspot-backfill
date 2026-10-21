import 'dotenv/config';
import { hs } from './hubspot.js';

const pick = (label, i) => ({ label, value: label, displayOrder: i });

const props = [
  {
    name: 'imported_create_date',
    label: 'Deal Created (imported)',
    type: 'date',
    fieldType: 'date',
    groupName: 'dealinformation',
  },
  {
    name: 'deal_source',
    label: 'Deal Source',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'dealinformation',
    options: ['Paid Search', 'Organic', 'Outbound', 'Referral'].map(pick),
  },
  {
    name: 'rep_name',
    label: 'Rep (practice data)',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'dealinformation',
    options: ['Dana Whitfield', 'Marcus Hale', 'Priya Raman', 'Tom Becker', 'Alexis Cho'].map(pick),
  },
  {
    name: 'skipped_qualification',
    label: 'Skipped Qualification',
    type: 'enumeration',
    fieldType: 'booleancheckbox',
    groupName: 'dealinformation',
    options: [
      { label: 'Yes', value: 'true', displayOrder: 0 },
      { label: 'No', value: 'false', displayOrder: 1 },
    ],
  },
];

for (const p of props) {
  try {
    await hs('/crm/v3/properties/deals', { method: 'POST', body: JSON.stringify(p) });
    console.log('created', p.name);
  } catch (e) {
    // "Already exists" is fine and makes this re-runnable. Anything else is a
    // real problem and has to stop the script. Catching everything here would
    // be the exact mistake this sprint is about.
    if (e.status === 409) {
      console.log('already exists, skipping', p.name);
    } else {
      console.error('FAILED on', p.name);
      throw e;
    }
  }
}