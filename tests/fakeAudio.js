/*
 * A stand-in for the Web Audio API, for the sound's tests (Node has none): it builds the graph, and throws wherever a
 * browser would (a value that isn't a finite number, an exponential ramp to zero, a source started twice, a disconnect
 * from something that isn't connected...), so a test can play every sound there is and find what a browser would
 * choke on. Nothing is heard; `currentTime` moves only when a test moves it.
 */

const check = (value, what) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${what}: ${value} isn't a finite number`);
};
const checkTime = (time, what) => {
    check(time, what);
    if (time < 0) throw new RangeError(`${what}: negative time ${time}`);
};

export class FakeParam {
    constructor(context, value) {
        this.context = context;
        this._value = value;
        /** Every change asked of it, as [kind, value, time]. */
        this.events = [];
        /** Nodes connected to it. */
        this.inputs = new Set();
    }

    get value() {
        return this._value;
    }

    set value(value) {
        check(value, 'AudioParam.value');
        this._value = value;
    }

    /** What it's heading for: the last value it was set or sent to. */
    get target() {
        const last = this.events.at(-1);
        return last ? last[1] : this._value;
    }

    setValueAtTime(value, time) {
        check(value, 'setValueAtTime');
        checkTime(time, 'setValueAtTime');
        this.events.push(['set', value, time]);
        return this;
    }

    linearRampToValueAtTime(value, time) {
        check(value, 'linearRamp');
        checkTime(time, 'linearRamp');
        this.events.push(['linear', value, time]);
        return this;
    }

    exponentialRampToValueAtTime(value, time) {
        check(value, 'exponentialRamp');
        checkTime(time, 'exponentialRamp');
        if (value === 0) throw new RangeError('exponentialRamp to 0');
        this.events.push(['exponential', value, time]);
        return this;
    }

    setTargetAtTime(value, time, timeConstant) {
        check(value, 'setTarget');
        checkTime(time, 'setTarget');
        checkTime(timeConstant, 'setTarget time constant');
        this.events.push(['target', value, time]);
        return this;
    }

    cancelScheduledValues(time) {
        checkTime(time, 'cancelScheduledValues');
        return this;
    }
}

export class FakeNode {
    constructor(context, params = {}) {
        this.context = context;
        /** @type {Set<FakeNode | FakeParam>} */
        this.outputs = new Set();
        /** @type {Set<FakeNode>} */
        this.inputs = new Set();
        for (const [name, value] of Object.entries(params)) this[name] = new FakeParam(context, value);
    }

    connect(destination) {
        if (!(destination instanceof FakeNode) && !(destination instanceof FakeParam)) throw new TypeError('connect: not a node or a param');
        if (destination.context !== this.context) throw new Error('connect: another context');
        this.outputs.add(destination);
        destination.inputs.add(this);
        return destination instanceof FakeParam ? undefined : destination;
    }

    disconnect(destination) {
        if (destination === undefined) {
            for (const output of this.outputs) output.inputs.delete(this);
            this.outputs.clear();
            return;
        }
        if (!this.outputs.has(destination)) throw new Error('disconnect: not connected to that');
        this.outputs.delete(destination);
        destination.inputs.delete(this);
    }

    /** Whether anything from here gets to the speakers. */
    reachesSpeakers(seen = new Set()) {
        if (this === this.context.destination) return true;
        if (seen.has(this)) return false;
        seen.add(this);
        for (const output of this.outputs) {
            if (output instanceof FakeNode && output.reachesSpeakers(seen)) return true;
        }
        return false;
    }
}

class FakeSource extends FakeNode {
    constructor(context, params) {
        super(context, params);
        this.started = null;
        this.stopped = null;
    }

    start(when = 0, offset = 0, duration) {
        if (this.started !== null) throw new Error('start: already started');
        checkTime(when, 'start');
        checkTime(offset, 'start offset');
        if (duration !== undefined) checkTime(duration, 'start duration');
        this.started = when;
        this.context.started.push(this);
    }

    stop(when = 0) {
        if (this.started === null) throw new Error('stop: not started');
        checkTime(when, 'stop');
        this.stopped = when;
    }
}

class FakeOscillator extends FakeSource {
    constructor(context) {
        super(context, { frequency: 440, detune: 0 });
        this.type = 'sine';
    }

    setPeriodicWave(wave) {
        if (!wave?.periodic) throw new TypeError('setPeriodicWave: not a wave');
        this.type = 'custom';
    }
}

class FakeBufferSource extends FakeSource {
    constructor(context) {
        super(context, { playbackRate: 1, detune: 0 });
        this._buffer = null;
        this.loop = false;
    }

    get buffer() {
        return this._buffer;
    }

    set buffer(buffer) {
        if (this._buffer) throw new Error('buffer: set twice');
        this._buffer = buffer;
    }

    start(when = 0, offset = 0, duration) {
        if (!this._buffer) throw new Error('start: no buffer');
        super.start(when, offset, duration);
    }
}

class FakeBuffer {
    constructor(channels, length, sampleRate) {
        if (!(channels >= 1) || !(length >= 1)) throw new RangeError('createBuffer: empty');
        this.numberOfChannels = channels;
        this.length = length;
        this.sampleRate = sampleRate;
        this.duration = length / sampleRate;
        this._data = Array.from({ length: channels }, () => new Float32Array(length));
    }

    getChannelData(channel) {
        return this._data[channel];
    }
}

class FakeConvolver extends FakeNode {
    get buffer() {
        return this._buffer ?? null;
    }

    set buffer(buffer) {
        if (![1, 2, 4].includes(buffer.numberOfChannels)) throw new Error('convolver: channels');
        if (buffer.sampleRate !== this.context.sampleRate) throw new Error('convolver: sample rate');
        for (let c = 0; c < buffer.numberOfChannels; c++) {
            if (buffer.getChannelData(c).some((v) => !Number.isFinite(v))) throw new Error('convolver: not a number in the impulse');
        }
        this._buffer = buffer;
    }
}

export class FakeAudioContext {
    constructor() {
        this.sampleRate = 48000;
        this.currentTime = 0;
        this.state = 'suspended';
        this.destination = new FakeNode(this);
        /** Every source started, in order. */
        this.started = [];
        this.suspends = 0;
        this.resumes = 0;
    }

    async resume() {
        this.resumes++;
        this.state = 'running';
    }

    async suspend() {
        this.suspends++;
        this.state = 'suspended';
    }

    createGain() {
        return new FakeNode(this, { gain: 1 });
    }

    createBiquadFilter() {
        const node = new FakeNode(this, { frequency: 350, Q: 1, gain: 0, detune: 0 });
        node.type = 'lowpass';
        return node;
    }

    createStereoPanner() {
        return new FakeNode(this, { pan: 0 });
    }

    createDelay(maxDelayTime = 1) {
        checkTime(maxDelayTime, 'createDelay');
        return new FakeNode(this, { delayTime: 0 });
    }

    createConvolver() {
        return new FakeConvolver(this);
    }

    createOscillator() {
        return new FakeOscillator(this);
    }

    createBufferSource() {
        return new FakeBufferSource(this);
    }

    createBuffer(channels, length, sampleRate) {
        return new FakeBuffer(channels, length, sampleRate);
    }

    createPeriodicWave(real, imag) {
        if (real.length !== imag.length || real.length < 2) throw new Error('createPeriodicWave: lengths');
        return { periodic: true };
    }
}
