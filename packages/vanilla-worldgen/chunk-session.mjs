export const VANILLA_CHUNK_OFFER_ID = 0x4b;
export const VANILLA_CHUNK_ACK_ID = 0x20;
export const VANILLA_CHUNK_UNLOAD_ID = 0x4c;
export const VANILLA_SOURCE_SHA = '4508d006323f24fa02876310c192d739af56516eb259000ac50f0909a68c9a2d';

export function validateChunkOffer(offer) {
    if (!offer || offer.protocol !== 1 || offer.source !== VANILLA_SOURCE_SHA || !Number.isInteger(offer.token) || offer.token <= 0 || offer.token > 0x7fffffff ||
        !['overworld', 'large_biomes', 'amplified', 'nether', 'end'].includes(offer.settings)) throw new Error('Unsupported vanilla chunk offer');
    const [minY, height] = ['nether', 'end'].includes(offer.settings) ? [0, 128] : [-64, 384];
    if (offer.minY !== minY || offer.height !== height) throw new Error('Vanilla offer dimension range mismatch');
    return { protocol: 1, source: offer.source, token: offer.token, settings: offer.settings, minY, height };
}

export function acceptChunkAcknowledgement(player, ack) {
    const offer = player.pendingVanillaOffer;
    if (!offer || ack?.token !== offer.token || ack.protocol !== 1 || ack.source !== VANILLA_SOURCE_SHA || typeof ack.accepted !== 'boolean') throw new Error('Unexpected vanilla chunk acknowledgement');
    player.pendingVanillaOffer = null;
    player.vanillaChunkProtocol = ack.accepted ? 1 : 0;
    player.vanillaChunkSettings = ack.accepted ? offer : null;
    return ack.accepted;
}
