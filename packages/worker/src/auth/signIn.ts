import { generate, type AppModel } from '@feature-domain/engine'

/** The feature that gives an app sign-in (added to the engine with the sign-in page). */
export const SIGN_IN_FEATURE = 'SignInFeature'

/**
 * Whether a version to publish has sign-in, so its app needs auth tables: a Sign-in feature that generates, as publish's
 * other checks read the generated document (a disabled one counts for nothing).
 */
export const hasSignIn = (model: AppModel): boolean => generate(model).metadata.features.some((f) => f.feature === SIGN_IN_FEATURE && f.status === 'generated')
