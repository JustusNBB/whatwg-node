import { create } from 'w3-server';
import { createServer, Server } from 'http';
import { Request, Response, ReadableStream, fetch } from 'cross-undici-fetch';
import { Readable } from 'stream';

const methodsWithoutBody = ['GET', 'DELETE'];

const methodsWithBody = ['POST', 'PUT', 'PATCH'];

async function compareRequest(toBeChecked: Request, expected: Request) {
  expect(toBeChecked.method).toBe(expected.method);
  expect(toBeChecked.url).toBe(expected.url);
  expected.headers.forEach((value, key) => {
    const toBeCheckedValue = toBeChecked.headers.get(key);
    expect({
      key,
      value: toBeCheckedValue,
    }).toMatchObject({
      key,
      value,
    });
  });
}

async function compareReadableStream(toBeChecked: ReadableStream | null, expected: BodyInit | null) {
  if (expected) {
    const expectedBody = new Response(expected).body;
    const expectedStream = Readable.from(expectedBody as any);
    const toBeCheckedIterator = Readable.from(toBeChecked as any)[Symbol.asyncIterator]();
    for await (const expectedValue of expectedStream) {
      const toBeCheckedResult = await toBeCheckedIterator.next();
      if (expectedValue) {
        expect(Buffer.from(toBeCheckedResult.value).toString()).toBe(Buffer.from(expectedValue).toString());
      }
    }
  }
}

async function compareResponse(toBeChecked: Response, expected: Response) {
  expect(toBeChecked.status).toBe(expected.status);
  expected.headers.forEach((value, key) => {
    const toBeCheckedValue = toBeChecked.headers.get(key);
    expect({
      key,
      value: toBeCheckedValue,
    }).toMatchObject({
      key,
      value,
    });
  });
}

let httpServer: Server;
async function runTestForRequestAndResponse({
  expectedRequest,
  expectedResponse,
  port,
  getRequestBody,
  getResponseBody,
}: {
  expectedRequest: Request;
  expectedResponse: Response;
  port: number;
  getRequestBody: () => BodyInit;
  getResponseBody: () => BodyInit;
}) {
  const { requestListener, addEventListener } = create();
  httpServer = createServer(requestListener);
  httpServer.listen(port);
  addEventListener(fetchEvent => {
    fetchEvent.respondWith(
      Promise.resolve().then(async () => {
        await compareRequest(fetchEvent.request, expectedRequest);
        if (methodsWithBody.includes(expectedRequest.method)) {
          await compareReadableStream(fetchEvent.request.body, getRequestBody());
        }
        return expectedResponse;
      })
    );
  });
  const returnedResponse = await fetch(expectedRequest);
  await compareResponse(returnedResponse, expectedResponse);
  await compareReadableStream(returnedResponse.body, getResponseBody());
}

function getRegularRequestBody() {
  return JSON.stringify({ requestFoo: 'requestFoo' });
}

function getRegularResponseBody() {
  return JSON.stringify({ responseFoo: 'responseFoo' });
}

function getIncrementalRequestBody() {
  return new ReadableStream({
    async start(controller) {
      for (let i = 0; i < 2; i++) {
        await new Promise(resolve => setTimeout(resolve, 30));
        controller.enqueue(`data: request_${i.toString()}\n`);
      }
      controller.close();
    },
  });
}

function getIncrementalResponseBody() {
  return new ReadableStream({
    async start(controller) {
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 30));
        controller.enqueue(`data: response_${i.toString()}\n`);
      }
      controller.close();
    },
  });
}

const port = 9876;
describe('Test', () => {
  afterEach(async () => {
    await new Promise(resolve => httpServer?.close(resolve));
  });
  [...methodsWithBody, ...methodsWithoutBody].forEach(method => {
    it(`should handle regular requests with ${method}`, async () => {
      const requestInit: RequestInit = {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'random-header': Date.now().toString(),
        },
      };
      if (methodsWithBody.includes(method)) {
        requestInit.body = getRegularRequestBody();
      }
      const expectedRequest = new Request(`http://localhost:${port}`, requestInit);
      const expectedResponse = new Response(getRegularResponseBody(), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'random-header': Date.now().toString(),
        },
      });
      await runTestForRequestAndResponse({
        expectedRequest,
        getRequestBody: getRegularRequestBody,
        expectedResponse,
        getResponseBody: getRegularResponseBody,
        port,
      });
    });
    it(`should handle incremental responses with ${method}`, async () => {
      const requestInit: RequestInit = {
        method,
        headers: {
          accept: 'application/json',
          'random-header': Date.now().toString(),
        },
      };
      if (methodsWithBody.includes(method)) {
        requestInit.body = getRegularRequestBody();
      }
      const expectedRequest = new Request(`http://localhost:${port}`, requestInit);
      const expectedResponse = new Response(getIncrementalResponseBody(), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'random-header': Date.now().toString(),
        },
      });
      await runTestForRequestAndResponse({
        expectedRequest,
        getRequestBody: getRegularRequestBody,
        expectedResponse,
        getResponseBody: getIncrementalResponseBody,
        port,
      });
    });
  });
  methodsWithBody.forEach(method => {
    it(`should handle incremental requests with ${method}`, async () => {
      const requestInit: RequestInit = {
        method,
        headers: {
          accept: 'application/json',
          'random-header': Date.now().toString(),
        },
      };
      if (methodsWithBody.includes(method)) {
        requestInit.body = getIncrementalRequestBody();
      }
      const expectedRequest = new Request(`http://localhost:${port}`, requestInit);
      const expectedResponse = new Response(getRegularResponseBody(), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'random-header': Date.now().toString(),
        },
      });
      await runTestForRequestAndResponse({
        expectedRequest,
        getRequestBody: getIncrementalRequestBody,
        expectedResponse,
        getResponseBody: getRegularResponseBody,
        port,
      });
    });
  });
});
