import Random from "../../../util/Random.js";
import ByteBuf from "./ByteBuf.js";
import {require} from "./Require.js";

export default class CryptManager {

    static createNewSharedKey() {
        let key = new Uint8Array(16);
        window.crypto.getRandomValues(key);
        return key;
    }

    static encryptRSA(publicKey, data) {
        let asn1 = require("ASN1").parse(new Uint8Array(publicKey))
        let bigintModArith = require("bigint-mod-arith");

        let n = bigintModArith.bytesToBigInt(asn1.children[1].children[0].children[0].value);
        let e = bigintModArith.bytesToBigInt(asn1.children[1].children[0].children[1].value);

        let length = (n.toString(2).length + 7) >> 3;
        if (length < data.length + 11) {
            throw new Error("Data is too long to encrypt");
        }

        let buffer = new ByteBuf(new Uint8Array(data).reverse());
        buffer.setPosition(buffer.length());

        buffer.writeByte(0x0);
        let random = new Random();
        let x = [];
        while (buffer.length() < length - 2) {
            x[0] = 0;
            while (x[0] === 0) random.nextBytes(x, x.length);
            buffer.writeByte(x[0]);
        }
        buffer.writeByte(0x2);
        buffer.writeByte(0x0);

        let reversed = buffer.getArray().reverse();

        let bigInt = bigintModArith.bytesToBigInt(reversed);

        bigInt = bigintModArith.modPow(bigInt, e, n);

        return bigintModArith.bigIntToBytes(bigInt);
    }

}