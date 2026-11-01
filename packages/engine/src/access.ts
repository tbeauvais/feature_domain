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

/** Whether any of the table's rules needs to know who is signed in. */
export const accessNeedsSignIn = (access: TableAccess) => [access.see, access.add, access.change, access.delete].some(needsPerson)
