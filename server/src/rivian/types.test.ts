import { describe, expect, it } from 'vitest';
import {
  RivianInvalidOtpError,
  RivianRateLimitError,
  RivianUnauthenticatedError,
  describeRivianError,
  isGraphqlValidationError,
  mapGraphqlError,
} from './types.js';

describe('error helpers', () => {
  it('recognizes GraphQL validation failures', () => {
    expect(
      isGraphqlValidationError(mapGraphqlError([{ message: 'Error in GraphQL validation' }])),
    ).toBe(true);
    expect(
      isGraphqlValidationError(
        mapGraphqlError([{ extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }]),
      ),
    ).toBe(true);
    expect(
      isGraphqlValidationError(mapGraphqlError([{ extensions: { code: 'UNAUTHENTICATED' } }])),
    ).toBe(false);
  });

  it('describes every error entry', () => {
    const errors = [
      { message: 'Error in GraphQL validation' },
      { message: 'Cannot query field "x" on type "VehicleState".' },
    ];
    const text = describeRivianError(mapGraphqlError(errors, 400, { errors }));
    expect(text).toContain('Cannot query field');
  });
});

describe('error mapping', () => {
  it('maps UNAUTHENTICATED', () => {
    expect(mapGraphqlError([{ extensions: { code: 'UNAUTHENTICATED' } }])).toBeInstanceOf(
      RivianUnauthenticatedError,
    );
  });

  it('maps invalid OTP variants', () => {
    expect(
      mapGraphqlError([{ extensions: { code: 'BAD_USER_INPUT', reason: 'INVALID_OTP' } }]),
    ).toBeInstanceOf(RivianInvalidOtpError);
    expect(
      mapGraphqlError([{ extensions: { code: 'UNAUTHENTICATED', reason: 'OTP_TOKEN_EXPIRED' } }]),
    ).toBeInstanceOf(RivianInvalidOtpError);
  });

  it('maps RATE_LIMIT', () => {
    expect(mapGraphqlError([{ extensions: { code: 'RATE_LIMIT' } }])).toBeInstanceOf(
      RivianRateLimitError,
    );
  });
});
