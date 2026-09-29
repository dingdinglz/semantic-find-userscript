import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockGM } from './helpers';
import { parseHTTP, request, retryAfter, validateEndpoint, requireSafeTransport } from '../../src/userscript/transport/gm-request';
import type { GMRequestDetails } from '../../src/shared/types';
beforeEach(() => mockGM());
afterEach(() => vi.useRealTimers());
describe('GM transport security and cancellation', () => {
  it('fails closed for old/unknown managers rather than probing with a key', () => {
    vi.stubGlobal('GM_info', { scriptHandler: 'Tampermonkey', version: '4.18' }); expect(requireSafeTransport).toThrow();
    vi.stubGlobal('GM_info', { scriptHandler: 'OtherManager', version: '7.0' }); expect(requireSafeTransport).toThrow();
    vi.stubGlobal('GM_info', { scriptHandler: 'Tampermonkey', version: '5.4.1' }); expect(requireSafeTransport).not.toThrow();
  });
  it.each(['https://evil.test/v1/systemone', 'https://api.typesafe.ai.evil.test/v1/systemone', 'http://api.typesafe.ai/v1/systemone', 'https://api.typesafe.ai/v1/systemone?x=1', 'https://user@api.typesafe.ai/v1/systemone', 'https://api.typesafe.ai/v1/models', 'https://api.typesafe.ai/other', 'https://api.typesafe.ai/a/../v1/systemone'])('rejects unauthorized POST endpoint %s', url => { expect(() => validateEndpoint(url, 'POST')).toThrow(); });
  it('enforces anonymous, no-referrer, reject-redirect flags and only puts key in authorization', async () => {
    let details!: GMRequestDetails;
    const pending = request('/v1/systemone', 'fake-key', new AbortController().signal, 1000, '{"state":"safe"}', d => { details = d; return { abort() {} }; });
    expect(details.anonymous).toBe(true); expect(details.redirect).toBe('error'); expect(details.headers.Referer).toBe('');
    expect(details.headers.Authorization).toBe('Bearer fake-key'); expect(details.data).not.toContain('fake-key');
    details.onload({ status: 200, responseText: '{}', responseHeaders: '', finalUrl: details.url }); await expect(pending).resolves.toMatchObject({ status: 200 });
  });
  it('uses a manual timeout and rejects late onload even if abort is ineffective', async () => {
    vi.useFakeTimers(); let details!: GMRequestDetails; const abort = vi.fn();
    const pending = request('/v1/models', 'fake', new AbortController().signal, 1000, undefined, d => { details = d; return { abort }; });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' }); await vi.advanceTimersByTimeAsync(1000); await assertion;
    expect(abort).toHaveBeenCalledOnce(); details.onload({ status: 200, responseText: '{}', responseHeaders: '' });
  });
  it('does not send after cancellation and catches unexpected final URLs', async () => {
    const abort = new AbortController(); abort.abort(); const send = vi.fn();
    expect(() => request('/v1/models', 'fake', abort.signal, 1000, undefined, send)).toThrow(); expect(send).not.toHaveBeenCalled();
    const pending = request('/v1/models', 'fake', new AbortController().signal, 1000, undefined, d => {
      d.onload({ status: 200, responseText: '{}', responseHeaders: '', finalUrl: 'https://evil.test' }); return { abort() {} };
    }); await expect(pending).rejects.toMatchObject({ code: 'protocol' });
  });
  it('classifies HTTP errors without returning or displaying arbitrary response bodies', () => {
    for (const [status, code] of [[401, 'auth'], [403, 'auth'], [429, 'rate'], [529, 'rate'], [503, 'server'], [422, 'protocol']] as const) {
      expect(() => parseHTTP({ status, responseText: 'private upstream details', responseHeaders: '' })).toThrow(expect.objectContaining({ code }));
    }
    expect(() => parseHTTP({ status: 422, responseText: '{"code":"context_length_exceeded"}', responseHeaders: '' })).toThrow(expect.objectContaining({ code: 'length' }));
    expect(() => parseHTTP({ status: 200, responseText: '<html>', responseHeaders: '' })).toThrow(expect.objectContaining({ code: 'protocol' }));
    expect(retryAfter('Retry-After: 3\r\n')).toBe(3000);
    expect(retryAfter('retry-after: Wed, 21 Oct 2015 07:28:00 GMT', Date.parse('2015-10-21T07:27:58Z'))).toBe(2000);
  });
});
