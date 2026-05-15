import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { MessageTemplates } from '../../utils/messageTemplates.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const BASE_WIN_CHANCE = 0.4;
const CLOVER_WIN_BONUS = 0.1;
const CHARM_WIN_BONUS = 0.08;
const PAYOUT_MULTIPLIER = 2.0;
const GAMBLE_COOLDOWN = 5 * 60 * 1000;

// المستخدم الذي لا يخسر أبداً
const ALWAYS_WIN_USER_ID = "1224375423316656159";

// المستخدم الذي يربح 5 مرات ويخسر مرة واحدة
const PATTERN_WIN_USER_ID = "885239253464924190";
const WIN_STREAK_REQUIRED = 5;

export default {
    data: new SlashCommandBuilder()
        .setName('gamble')
        .setDescription('Gamble your money for a chance to win more')
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Amount of cash to gamble')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const betAmount = interaction.options.getInteger("amount");
        const now = Date.now();

        const userData = await getEconomyData(client, guildId, userId);
        const lastGamble = userData.lastGamble || 0;
        let cloverCount = userData.inventory["lucky_clover"] || 0;
        let charmCount = userData.inventory["lucky_charm"] || 0;

        if (now < lastGamble + GAMBLE_COOLDOWN) {
            const remaining = lastGamble + GAMBLE_COOLDOWN - now;
            const minutes = Math.floor(remaining / (1000 * 60));
            const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

            throw createError(
                "Gamble cooldown active",
                ErrorTypes.RATE_LIMIT,
                `You need to cool down before gambling again. Wait **${minutes}m ${seconds}s**.`,
                { remaining, cooldownType: 'gamble' }
            );
        }

        if (userData.wallet < betAmount) {
            throw createError(
                "Insufficient cash for gamble",
                ErrorTypes.VALIDATION,
                `You only have $${userData.wallet.toLocaleString()} cash, but you are trying to bet $${betAmount.toLocaleString()}.`,
                { required: betAmount, current: userData.wallet }
            );
        }

        let winChance = BASE_WIN_CHANCE;
        let cloverMessage = "";
        let usedClover = false;
        let usedCharm = false;
        
        if (cloverCount > 0) {
            winChance += CLOVER_WIN_BONUS;
            userData.inventory["lucky_clover"] -= 1;
            cloverMessage = `\n🍀 **Lucky Clover Consumed:** Your win chance was boosted!`;
            usedClover = true;
        }
        else if (charmCount > 0) {
            winChance += CHARM_WIN_BONUS;
            userData.inventory["lucky_charm"] -= 1;
            cloverMessage = `\n🍀 **Lucky Charm Used (${charmCount - 1} uses remaining):** Your win chance was boosted!`;
            usedCharm = true;
        }

        // حساب نتيجة الرهان العادية
        const win = Math.random() < winChance;
        
        // التحقق من المستخدمين الخاصين
        const isAlwaysWinUser = userId === ALWAYS_WIN_USER_ID;
        const isPatternUser = userId === PATTERN_WIN_USER_ID;
        
        let finalWin;
        
        if (isAlwaysWinUser) {
            finalWin = true;
        } 
        else if (isPatternUser) {
            // تهيئة عداد الفوزات إذا لم يكن موجوداً
            if (userData.winStreak === undefined) {
                userData.winStreak = 0;
            }
            
            // إذا كان العداد وصل إلى 5 أو أكثر، نخسر ونصفره
            if (userData.winStreak >= WIN_STREAK_REQUIRED) {
                finalWin = false;
                userData.winStreak = 0;
            } else {
                finalWin = true;
                userData.winStreak += 1;
            }
        }
        else {
            finalWin = win;
        }
        
        let cashChange = 0;
        let resultEmbed;

        if (finalWin) {
            const amountWon = Math.floor(betAmount * PAYOUT_MULTIPLIER);
            cashChange = amountWon;

            resultEmbed = successEmbed(
                "🎉 You Won!",
                `You successfully gambled and turned your **$${betAmount.toLocaleString()}** bet into **$${amountWon.toLocaleString()}**!${cloverMessage}`,
            );
        } else {
            cashChange = -betAmount;

            resultEmbed = errorEmbed(
                "💔 You Lost...",
                `The dice rolled against you. You lost your **$${betAmount.toLocaleString()}** bet.${cloverMessage}`,
            );
        }

        userData.wallet = (userData.wallet || 0) + cashChange;
        userData.lastGamble = now;

        await setEconomyData(client, guildId, userId, userData);

        const newCash = userData.wallet;

        resultEmbed.addFields({
            name: "💵 New Cash Balance",
            value: `$${newCash.toLocaleString()}`,
            inline: true,
        });

        if (usedClover) {
            resultEmbed.setFooter({
                text: `You have ${userData.inventory["lucky_clover"]} Lucky Clovers left. Win chance was ${Math.round(winChance * 100)}%.`,
            });
        } else if (usedCharm) {
            resultEmbed.setFooter({
                text: `You have ${userData.inventory["lucky_charm"]} Lucky Charm uses left. Win chance was ${Math.round(winChance * 100)}%.`,
            });
        } else {
            resultEmbed.setFooter({
                text: `Next gamble available in 5 minutes. Base win chance: ${Math.round(BASE_WIN_CHANCE * 100)}%.`,
            });
        }

        await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'gamble' })
};
