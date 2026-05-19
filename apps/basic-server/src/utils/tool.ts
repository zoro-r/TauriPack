export function success(data: any, message: string = 'success') {
  return {
    code: 200,
    data,
    message,
  }
}

export function fail(message: string = 'fail') {
  return {
    code: -1,
    message,
  }
}

export function error(message: string = 'error', err?: any) {
  return {
    code: -1,
    message,
    error: err?.message || err,
  }
}

/**
 * 微信支付回调成功响应
 * 微信支付要求返回格式：{ code: 'SUCCESS', message: '...' }
 */
export function wechatSuccess(message: string = '成功') {
  return { code: 'SUCCESS', message };
}

/**
 * 微信支付回调失败响应
 * 微信支付要求返回格式：{ code: 'FAIL', message: '...' }
 */
export function wechatFail(message: string = '处理失败') {
  return { code: 'FAIL', message };
}
