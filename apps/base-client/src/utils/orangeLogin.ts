import request, { isAuthErrorMessage } from './request';

type OrangeLoginStatus = 'browser' | 'scan-required' | 'wechat-required' | 'signed-in';
type OrangeLoginProof = { ticket: string } | { mode: 'wechat' };
type AuthBridge = {
  getContext(): Promise<{ chaobenLogin?: boolean }>;
  chaobenTicket?(): Promise<OrangeLoginProof>;
};
let opening: Promise<OrangeLoginStatus> | undefined;
let lastResult: Promise<OrangeLoginStatus> | undefined;

const getAuthBridge = () => (window as Window & { orangeApp?: { auth?: AuthBridge } }).orangeApp?.auth;
export const hasOrangeLoginBridge = () => Boolean(getAuthBridge()?.chaobenTicket);

async function openFromClient(): Promise<OrangeLoginStatus> {
  const auth = getAuthBridge();
  if (!auth?.chaobenTicket || !(await auth.getContext()).chaobenLogin) return 'browser';
  const proof = await auth.chaobenTicket();
  if ('mode' in proof) {
    // Electron keeps this site's cookies in the current Orange account's
    // browser partition. Cloud authenticates those cookies on each open.
    try {
      await request('/api/auth/me', { alert: false });
      return 'signed-in';
    } catch (error) {
      if (error instanceof Error && isAuthErrorMessage(error.message)) return 'wechat-required';
      throw error;
    }
  }
  const result = await request<{ status: 'scan-required' | 'signed-in' }>('/api/auth/orange/session', {
    method: 'POST',
    data: { ticket: proof.ticket },
    alert: false
  });
  return result.status;
}

export function openOrangeLogin(retry = false) {
  if (opening) return opening;
  if (!lastResult || retry) {
    lastResult = opening = openFromClient();
    const finish = () => { opening = undefined; };
    void opening.then(finish, finish);
  }
  return lastResult;
}

export function getWechatLoginQr<T>(bindOrange: boolean) {
  return request<T>('/api/auth/wechat/qr', {
    ...(bindOrange && { params: { bindOrange: '1' } }),
    alert: false
  });
}

export function completeWechatLogin(loginCode: string, bindOrange: boolean) {
  return request('/api/auth/token', {
    method: 'POST',
    data: { loginCode, ...(bindOrange && { bindOrange: true }) },
    alert: false
  });
}
