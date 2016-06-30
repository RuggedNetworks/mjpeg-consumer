var util = require('util');
var debug = require('debug')('mjpeg');
var Transform = require('stream').Transform;
var lengthRegex = /Content-Length:\s*(\d+)/i;

// Start of Image
var soi = new Buffer(2);
soi.writeUInt16LE(0xd8ff, 0);

// End of Image
var eoi = new Buffer(2);
eoi.writeUInt16LE(0xd9ff, 0);

function MjpegConsumer(options) {
    if (!(this instanceof MjpegConsumer)) {
        return new MjpegConsumer(options);
    }

    Transform.call(this, options);

    this.buffer = null;
    this.reading = false;
    this.contentLength = null;
    this.bytesWritten = 0;
}
util.inherits(MjpegConsumer, Transform);

/**
 * @param {Number} len - length to initialize buffer
 * @param {Buffer} chunk - chunk of http goodness
 * @param {Number=} start - optional index of start of jpeg chunk
 * @param {Number=} end - optional index of end of jpeg chunk
 *
 * Initialize a new buffer and reset state
 */
MjpegConsumer.prototype._initFrame = function (len, chunk, start, end) {
    this.contentLength = len;
    this.buffer = Buffer.allocUnsafe(len);
    debug("Created buffer of " + this.buffer.length);
    this.bytesWritten = 0;

    var hasStart = typeof start !== 'undefined' && start > -1;
    var hasEnd = typeof end !== 'undefined' && end > -1 && end > start;

    if (hasStart) {
        var bufEnd = chunk.length;

        if (hasEnd) {
            bufEnd = end + eoi.length;
        }

        chunk.copy(this.buffer, 0, start, bufEnd);

        this.bytesWritten = chunk.length - start;
        // If we have the eoi bytes, send the frame
        if (hasEnd) {
            debug("Start and end are in same chunk, send frame");
            this._sendFrame();
            return;
        }
    }

    this.reading = true;
};

/**
 * @param {Buffer} chunk - chunk of http goodness
 * @param {Number} start - index of start of jpeg in chunk
 * @param {Number} end - index of end of jpeg in chunk
 *
 */
MjpegConsumer.prototype._readFrame = function (chunk, start, end) {
    var bufStart = start > -1 && start < end ? start : 0;
    var bufEnd = end > -1 ? end + eoi.length : chunk.length;

    debug("Copying start " + bufStart + " and end" + bufEnd + " into buffer");

    chunk.copy(this.buffer, this.bytesWritten, bufStart, bufEnd);
    this.bytesWritten += bufEnd - bufStart;

    if (end > -1 || this.bytesWritten === this.contentLength) {
        debug("Read entire frame sending");
        this._sendFrame();
    } else {
        this.reading = true;
    }
};

/**
 * Handle sending the frame to the next stream and resetting state
 */
MjpegConsumer.prototype._sendFrame = function () {
    debug("Sending frame setting reading to false");
    this.reading = false;
    this.push(this.buffer);
};

MjpegConsumer.prototype._transform = function (chunk, encoding, done) {
    var start = -1;
    var end = -1;
    var len = null;

    debug("Got new chunk")
    debug(chunk);

    if (this.reading && (this.bytesWritten + chunk.length >= this.contentLength)) {
        end = chunk.indexOf(eoi);
        debug("Found end in current chunk " + end);
        if (end === -1) {
            debug("something has gone badly wrong");
            this.reading = false;
            this.buffer = null;
        }
    }

    if (this.reading === false) {
        debug("Not reading " + this.reading + " finding start chunk");
        start = chunk.indexOf(soi);
        len = (lengthRegex.exec(chunk.toString('ascii')) || [])[1];
        debug("Found start" + start);
        debug("Found length" + len);
    }


    if (this.buffer && this.reading) {
        debug("Found frame and already reading start " + start + " end " + end);
        this._readFrame(chunk, start, end);
        if (!this.reading) {
            debug("Looking for another frame inside this one");
            start = chunk.indexOf(soi);
            len = (lengthRegex.exec(chunk.toString('ascii')) || [])[1];
            debug("Found start" + start);
            debug("Found length" + len);
        }
    }

    if (len) {
        debug("Found length of image reading " + len);
        this._initFrame(+len, chunk, start, end);
    }

    done();
};

module.exports = MjpegConsumer;
