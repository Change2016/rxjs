import { ObservableInput, Source, FOType, Sink, ObservableInteroperable, ObservableLike } from "../types";
import { Observable, sourceAsObservable } from "../Observable";
import { Subscription } from "../Subscription";
import { ofSource } from "./of";
import { symbolObservable } from "../util/symbolObservable";
import { symbolAsyncIterator } from '../util/symbolAsyncIterator';

export function from<T>(input: ObservableInput<T>): Observable<T> {
  return sourceAsObservable(fromSource(input));
}

export function fromSource<T>(input: any): Source<T> {
  if (input instanceof Observable) {
    return input;
  } else if (typeof input.then === 'function') {
    return promiseSource(input);
  } else if (isArrayLike(input)) {
    return ofSource(input);
  } else if (typeof input[Symbol.iterator] === 'function') {
    return iterableSource(input);
  } else if (typeof input[symbolObservable] === 'function') {
    return symbolObservableSource(input);
  } else if (typeof input[symbolAsyncIterator] === 'function') {
    return asyncIterableSource(input);
  }
  throw new Error('Unable to convert from input to Observable source');
}

function promiseSource<T>(promise: PromiseLike<T>): Source<T> {
  return (type: FOType.SUBSCRIBE, sink: Sink<T>, subs: Subscription) => {
    if (type === FOType.SUBSCRIBE) {
      let closed = false;
      subs.add(() => closed = true);
      promise.then(value => {
        if (!closed) {
          sink(FOType.NEXT, value, subs);
          sink(FOType.COMPLETE, undefined, subs);
        }
      }, err => {
        sink(FOType.ERROR, err, subs);
      });
    }
  };
}

function iterableSource<T>(iterable: Iterable<T>): Source<T> {
  return (type: FOType.SUBSCRIBE, sink: Sink<T>, subs: Subscription) => {
    if (type === FOType.SUBSCRIBE) {
      let closed = false;
      subs.add(() => closed = true);
      const iterator = iterable[Symbol.iterator]();
      while (true) {
        if (closed) return;
        const { done, value } = iterator.next();
        if (done) break;
        sink(FOType.NEXT, value, subs);
      }
      sink(FOType.COMPLETE, undefined, subs);
    }
  };
}

function symbolObservableSource<T>(input: ObservableInteroperable<T>) {
  return (type: FOType.SUBSCRIBE, sink: Sink<T>, subs: Subscription) => {
    if (type === FOType.SUBSCRIBE) {
      const obs: ObservableLike<T> = input[symbolObservable]();
      if (!obs) {
        sink(FOType.ERROR, new Error('invalid Symbol.observable implementation, observable not returned'), subs);
      }
      if (typeof obs.subscribe !== 'function') {
        sink(FOType.ERROR, new Error('invalid Symbol.observable implementation, no subscribe method on returned value'), subs);
        return;
      }
      let subscription: any;
      subs.add(() => {
        if (subscription && typeof subscription.unsubscribe === 'function') {
          subscription.unsubscribe();
        }
      });
      subscription = obs.subscribe({
        next(value: T) { sink(FOType.NEXT, value, subs); },
        error(err: any) { sink(FOType.ERROR, err, subs); },
        complete() { sink(FOType.COMPLETE, undefined, subs); },
      });
    }
  }
}

function asyncIterableSource<T>(input: AsyncIterable<T>) {
  return (type: FOType.SUBSCRIBE, sink: Sink<T>, subs: Subscription) => {
    if (type === FOType.SUBSCRIBE) {
      const ai = input[symbolAsyncIterator]() as AsyncIterator<T>;
      let getNextValue : () => Promise<void>;
      getNextValue = () => ai.next().then(result => {
        if (result.done) {
          sink(FOType.COMPLETE, undefined, subs);
        } else {
          sink(FOType.NEXT, result.value, subs);
          getNextValue();
        }
      }, err => {
        sink(FOType.ERROR, err, subs);
      })

      getNextValue();
    }
  };
}

function isArrayLike(obj: any) {
  return obj && typeof obj.length === 'number';
}
