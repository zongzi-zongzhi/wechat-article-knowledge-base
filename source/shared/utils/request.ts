/**
 * Wrapper around $fetch without retries. Normalize error messages so the UI
 * shows server-provided causes instead of a generic "Server Error".
 */
export const request = $fetch.create({
  retry: 0,
  method: 'GET',
  async onResponse() {},
  async onResponseError({ response, error }) {
    const payload = response?._data as
      | {
          statusMessage?: string;
          message?: string;
        }
      | undefined;

    const message =
      payload?.statusMessage ||
      payload?.message ||
      response?.statusText ||
      error?.message ||
      'Request failed';

    const normalizedError = new Error(message) as Error & {
      statusCode?: number;
      data?: unknown;
    };

    normalizedError.statusCode = response?.status;
    normalizedError.data = response?._data;

    throw normalizedError;
  },
});
