import ByteBuf from "./ByteBuf.js";
import {require} from "./Require.js";

export default class Authentication {

    constructor(networkManager) {
        this.networkManager = networkManager;
    }

    joinServer(profile, accessToken, serverId) {
        if (this.networkManager.useProxy) {
            this.networkManager.sendProxyPacket(1, {
                "accessToken": accessToken,
                "selectedProfile": profile.getCompactUUID(),
                "serverId": serverId
            });
        }
    }

    createServerHash(serverId, secretKey, publicKey) {
        let bytes = require("sha1").create()
            .update(new TextEncoder().encode(serverId))
            .update(secretKey)
            .update(new Uint8Array(publicKey))
            .digest()

        let buffer = new ByteBuf(new Int8Array(bytes));
        let sign = '';

        if (buffer.readByte() < 0) {
            let carry = true
            for (let pos = buffer.length() - 1; pos >= 0; --pos) {
                let value = buffer.readByte(pos);
                let newValue = ~value & 0xff

                if (carry) {
                    carry = newValue === 0xff
                    buffer.writeByte(carry ? 0 : newValue + 1, pos);
                } else {
                    buffer.writeByte(newValue, pos)
                }
            }
            sign = '-';
        }

        return sign + buffer.toString().replace(/^0+/g, '');
    }
}