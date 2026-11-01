import { generate, signInOf, type AppModel } from '@feature-domain/engine'

export { SIGN_IN_FEATURE } from '@feature-domain/engine'

/**
 * Whether a version to publish has sign-in, so its app needs auth tables: a Sign-in feature that generates, as publish's
 * other checks read the generated document (a disabled one counts for nothing).
 */
export const hasSignIn = (model: AppModel): boolean => signInOf(generate(model)) !== null
