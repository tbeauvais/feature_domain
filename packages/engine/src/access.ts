// Who may do what with a Database table's rows on the published app: a rule per operation, set on the table, compiled
// into its exports and enforced only by the Worker (the builder's draft rows are never checked).

/** Who may see, change or delete rows: anyone, people signed in, only the person who added the row, or no one. */
export const ROW_RULES = ['anyone', 'signed-in', 'owner', 'nobody'] as const
export type RowRule = (typeof ROW_RULES)[number]

/** Who may add rows (a row being added has no owner yet). */
export const ADD_RULES = ['anyone', 'signed-in', 'nobody'] as const
export type AddRule = (typeof ADD_RULES)[number]

/** What happens to a person's rows when they delete their account: deleted, or kept without their name. */
export const DELETED_ACCOUNT_ROWS = ['delete', 'keep'] as const
export type DeletedAccountRows = (typeof DELETED_ACCOUNT_ROWS)[number]

/** The operations a rule is set for: seeing covers listing the rows and reading one. */
export type RowOperation = 'see' | 'add' | 'change' | 'delete'

export interface TableAccess {
  see: RowRule
  add: AddRule
  change: RowRule
  delete: RowRule
  deletedAccounts: DeletedAccountRows
}

/** A table that says nothing: open to anyone (as every table was before rules), and a deleted person's rows go. */
export const OPEN_ACCESS: Readonly<TableAccess> = Object.freeze({ see: 'anyone', add: 'anyone', change: 'anyone', delete: 'anyone', deletedAccounts: 'delete' })

/** Whether a rule needs to know who is signed in. */
export const needsPerson = (rule: RowRule | AddRule) => rule === 'signed-in' || rule === 'owner'

/** The operation a rows request is: GET and HEAD see, POST adds, PATCH changes, DELETE deletes; undefined for others. */
export function rowOperation(method: string): RowOperation | undefined {
  return ({ GET: 'see', HEAD: 'see', POST: 'add', PATCH: 'change', DELETE: 'delete' } as const)[method.toUpperCase() as 'GET']
}

/**
 * The rules an operation answers to: its own, and for a change or delete the See rule too (no one changes what they
 * can't see). The Worker's checks and its choice of when to read the session both go by this.
 */
export function rulesFor(access: TableAccess, operation: RowOperation): (RowRule | AddRule)[] {
  return operation === 'change' || operation === 'delete' ? [access[operation], access.see] : [access[operation]]
}

/** Whether an operation on the table needs to know who is signed in. */
export const operationNeedsPerson = (access: TableAccess, operation: RowOperation) => rulesFor(access, operation).some(needsPerson)

/** Whether any of the table's rules needs to know who is signed in. */
export const accessNeedsSignIn = (access: TableAccess) => [access.see, access.add, access.change, access.delete].some(needsPerson)

/** Rules from the most open to the strictest: owner is stricter than signed in, as it needs someone signed in too. */
const STRICTNESS: readonly RowRule[] = ['anyone', 'signed-in', 'owner', 'nobody']

/**
 * The one rule an operation comes down to, the strictest of those it answers to (`rulesFor`): what a page goes by to
 * offer a control (a form, a row's Delete) only to someone the Worker would let use it.
 */
export function operationRule(access: TableAccess, operation: RowOperation): RowRule {
  return rulesFor(access, operation).reduce<RowRule>((a, b) => (STRICTNESS.indexOf(b) > STRICTNESS.indexOf(a) ? b : a), 'anyone')
}

/**
 * Whether a page needs to know which rows are the visitor's: a change or delete comes down to Owner, so only their own
 * rows get those controls. The Worker then marks their rows as theirs.
 */
export const marksOwnRows = (access: TableAccess) => operationRule(access, 'change') === 'owner' || operationRule(access, 'delete') === 'owner'
