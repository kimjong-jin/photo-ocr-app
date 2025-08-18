// services/apiService.ts (개선안)

export const callSaveTempApi = async (payload: SaveDataPayload): Promise<{ message: string }> => {
  const SAVE_TEMP_API_URL = import.meta.env.VITE_SAVE_TEMP_API_URL;
  const API_KEY = import.meta.env.VITE_API_KEY;

  if (!SAVE_TEMP_API_URL) throw new Error('VITE_SAVE_TEMP_API_URL 미설정');
  if (!API_KEY) throw new Error('VITE_API_KEY 미설정');

  try {
    const res = await fetch(SAVE_TEMP_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(payload),
    });

    // 실패 응답 본문 안전 처리
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      let msg = `API 오류: ${res.status} ${res.statusText}`;
      try {
        const js = raw ? JSON.parse(raw) : null;
        if (js?.message) msg = js.message;
      } catch {}
      // CORS 힌트
      if (res.status === 0 || !raw) {
        msg += ' (CORS 또는 네트워크 문제 가능성: 서버의 Access-Control-Allow-* 설정을 확인하세요)';
      }
      throw new Error(msg);
    }

    const data = await res.json().catch(() => ({}));
    return { message: data.message || 'Firestore에 성공적으로 저장되었습니다.' };
  } catch (err: any) {
    // 네트워크 레벨 실패 메시지 보강
    if (err?.name === 'TypeError') {
      throw new Error('네트워크/CORS 문제로 요청이 차단된 것 같습니다. 서버의 CORS 헤더와 HTTPS 여부를 확인하세요.');
    }
    throw new Error(err?.message || 'Firestore 임시 저장 중 알 수 없는 오류');
  }
};

export const callLoadTempApi = async (receiptNumber: string): Promise<LoadedData> => {
  const LOAD_TEMP_API_URL = import.meta.env.VITE_LOAD_TEMP_API_URL;
  const API_KEY = import.meta.env.VITE_API_KEY;

  if (!LOAD_TEMP_API_URL) throw new Error('VITE_LOAD_TEMP_API_URL 미설정');
  if (!API_KEY) throw new Error('VITE_API_KEY 미설정');

  const notFoundMsg = `저장된 임시 데이터를 찾을 수 없습니다 (접수번호: ${receiptNumber}).`;

  try {
    const url = new URL(LOAD_TEMP_API_URL);
    url.searchParams.set('receipt_no', receiptNumber);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-api-key': API_KEY,
      },
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      // 404는 명확히 not found 처리
      if (res.status === 404) throw new Error(notFoundMsg);

      let msg = `API 오류: ${res.status} ${res.statusText}`;
      try {
        const js = raw ? JSON.parse(raw) : null;
        if (js?.message) msg = js.message;
      } catch {}
      if (res.status === 0 || !raw) {
        msg += ' (CORS 또는 네트워크 문제 가능성: 서버의 Access-Control-Allow-* 설정을 확인하세요)';
      }
      throw new Error(msg);
    }

    const data = await res.json().catch(() => null);
    if (!data || !data.values || Object.keys(data.values).length === 0) {
      throw new Error(notFoundMsg);
    }
    return data as LoadedData;
  } catch (err: any) {
    if (err?.name === 'TypeError') {
      throw new Error('네트워크/CORS 문제로 요청이 차단된 것 같습니다. 서버의 CORS 헤더와 HTTPS 여부를 확인하세요.');
    }
    throw err;
  }
};
