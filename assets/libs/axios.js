const axios = {
  post: (url, data, config) => {
    return new Promise((resolve, reject) => {
      const { headers = {}, timeout = 0 } = config || {};
      const controller = new AbortController();
      const signal = controller.signal;

      let timeoutId;
      if (timeout) {
        timeoutId = setTimeout(() => {
          controller.abort();
          const err = new Error(`timeout of ${timeout}ms exceeded`);
          err.code = 'ECONNABORTED';
          err.isAxiosError = true;
          reject(err);
        }, timeout);
      }

      const requestOptions = {
        method: 'POST',
        headers,
        signal,
        body: data instanceof FormData ? data : JSON.stringify(data),
      };
      
      if(data instanceof FormData) {
          // When using FormData, let the browser set the Content-Type header with the correct boundary.
          // Deleting it from headers if it was manually set.
          if(requestOptions.headers['Content-Type']) {
              delete requestOptions.headers['Content-Type'];
          }
      }


      fetch(url, requestOptions)
        .then(async (response) => {
          clearTimeout(timeoutId);
          
          const responseData = await (async () => {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              return response.json();
            }
            return response.text();
          })();
          
          const result = {
            data: responseData,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            config,
            request: requestOptions,
          };

          if (response.ok) {
            resolve(result);
          } else {
            const error = new Error(`Request failed with status code ${response.status}`);
            error.isAxiosError = true;
            error.response = result;
            reject(error);
          }
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          if (err.name === 'AbortError') return; 
          const error = new Error(err.message);
          error.isAxiosError = true;
          reject(error);
        });
    });
  },

  isAxiosError: (payload) => {
    return !!(payload && payload.isAxiosError);
  },
};

export default axios;