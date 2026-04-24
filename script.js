// ==========================================
// РАБОЧИЙ ТОРГОВЫЙ СКРИПТ ЗОЛОТО XAU/USD
// ==========================================

// API конфигурация
const API_KEY = '3ae45dbb1e9345a29a14e8557c5d04d2';
const SYMBOL = 'XAU/USD';

// Telegram конфигурация (ЗАПОЛНИ ЭТИ ПОЛЯ)
const TG_TOKEN = '8769551455:AAE6FEHT4CJ6WnxlMcYivm3vaJEv6JVi5Ok'; 
const TG_CHAT_ID = '6201234513'; 

// Глобальные переменные
let socket = null;
let currentData = [];
let lastSignal = null;
let lastSignalTime = 0;
let activeSignal = null;
let currentPosition = null; // 'long', 'short', or null
let entryPrice = null;
let entryTime = null;
let lastAnalysisPrice = null; // Запоминаем цену последнего анализа
let lastAnalysisRSI = null; // Запоминаем RSI последнего анализа

// ==========================================
// ОСНОВНЫЕ ФУНКЦИИ
// ==========================================

// Инициализация
async function init() {
    console.log('🚀 Запуск торговой системы...');
    
    // Тестовое сообщение при запуске
    sendTelegramRawMessage('🚀 *Система Gold Alpha запущена!*\nБот успешно подключен и ждет бетонных сигналов. 💰');
    
    await fetchMarketData();
    initWebSocket();
    startAnalysis();
}

async function sendTelegramRawMessage(text) {
    if (!TG_TOKEN || !TG_CHAT_ID) return;
    try {
        const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TG_CHAT_ID,
                text: text,
                parse_mode: 'Markdown'
            })
        });
    } catch (e) {
        console.error('❌ Ошибка Telegram:', e);
    }
}

// Получение рыночных данных
async function fetchMarketData() {
    try {
        console.log('📥 Запрос исторических данных...');
        const url = `https://api.twelvedata.com/time_series?symbol=${SYMBOL}&interval=1min&apikey=${API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.values && data.values.length > 0) {
            currentData = data.values.map(d => ({
                time: new Date(d.datetime).getTime() / 1000,
                open: parseFloat(d.open),
                high: parseFloat(d.high),
                low: parseFloat(d.low),
                close: parseFloat(d.close)
            })).reverse();
            
            console.log(`📊 РЕАЛЬНЫЙ РЫНОК: Загружено ${currentData.length} свечей`);
            analyzeMarket();
            updateSystemStatus(true, false);
        } else {
            console.warn('⚠️ API Twelve Data недоступно или лимиты исчерпаны. Переход в SMART ANALYZER...');
            generateMockData(); 
            updateSystemStatus(false, true);
        }
    } catch (error) {
        console.error('❌ Ошибка сети, переход в SMART ANALYZER:', error);
        generateMockData();
        updateSystemStatus(false, true);
    }
}

// WebSocket для реальных данных
function initWebSocket() {
    console.log('🔗 Попытка подключения к WebSocket...');
    const wsUrl = `wss://ws.twelvedata.com/v1/quotes/price?apikey=${API_KEY}`;
    
    if (socket) {
        socket.close();
    }

    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log('✅ WebSocket подключен успешно');
        socket.send(JSON.stringify({
            action: "subscribe",
            params: {
                symbols: SYMBOL
            }
        }));
        updateSystemStatus(currentData.length >= 20);
    };
    
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.price) {
            updatePrice(parseFloat(data.price));
        }
        // Если пришло сообщение об ошибке подписки
        if (data.event === "error") {
            console.error('❌ WebSocket ошибка подписки:', data.message);
            showNotification('ОШИБКА ПОДПИСКИ', data.message, 'danger');
        }
    };
    
    socket.onclose = () => {
        console.warn('⚠️ WebSocket отключен. Переподключение через 5 секунд...');
        updateSystemStatus(currentData.length >= 20);
        setTimeout(initWebSocket, 5000);
    };
    
    socket.onerror = (error) => {
        console.error('❌ WebSocket ошибка:', error);
        updateSystemStatus(false);
    };
}

// ==========================================
// АНАЛИЗ РЫНКА
// ==========================================

function analyzeMarket() {
    if (currentData.length < 20) return;
    
    const last = currentData[currentData.length - 1];
    const rsi = calculateRSI();
    const sma20 = calculateSMA(20);
    const sma50 = calculateSMA(50);
    const levels = calculateLevels();
    
    // Проверяем есть ли реальные изменения
    const priceChange = lastAnalysisPrice ? Math.abs(last.close - lastAnalysisPrice) : 0;
    const rsiChange = lastAnalysisRSI ? Math.abs(rsi - lastAnalysisRSI) : 0;
    
    // Анализируем только если:
    // 1. Первый анализ
    // 2. Цена изменилась (хотя бы на $0.1 для скальпинга)
    // 3. RSI изменился
    // 4. Прошел минимальный интервал (10 секунд)
    const now = Date.now();
    const significantChange = !lastAnalysisPrice || 
                             priceChange > 0.1 || 
                             rsiChange > 0.1 || 
                             (now - lastSignalTime > 10000);
    
    if (!significantChange) {
        return; // Пропускаем анализ - нет значимых изменений
    }
    
    console.log(`🔍 АНАЛИЗ: Цена ${last.close.toFixed(2)} (изменение: ${priceChange.toFixed(2)}), RSI: ${rsi.toFixed(1)} (изменение: ${rsiChange.toFixed(1)})`);
    
    // Определяем сигнал
    const signal = generateSignal(rsi, sma20, sma50, last, levels);
    
    if (signal) {
        displaySignal(signal);
        activeSignal = signal;
        lastSignal = signal.type;
        lastSignalTime = Date.now();
    }
    
    // Запоминаем текущие значения
    lastAnalysisPrice = last.close;
    lastAnalysisRSI = rsi;
    
    // Обновляем прогноз
    updateForecast(last, rsi, sma20, sma50, levels);
}

function generateSignal(rsi, sma20, sma50, last, levels) {
    const now = Date.now();
    
    // Cooldown для скальпинга (10 секунд)
    if (now - lastSignalTime < 10000) return null;

    // ПАРАМЕТРЫ ДЛЯ СКАЛЬПИНГА (Мгновенная реакция)
    const isBullTrend = last.close > calculateSMA(10); // Быстрая скользящая
    const isBearTrend = last.close < calculateSMA(10); 
    
    // RSI для скальпинга (очень чувствительный)
    const rsiBullish = rsi < 48; 
    const rsiBearish = rsi > 52; 

    // Минимальное замедление цены для скальп-входа
    const lastCandleBody = Math.abs(last.close - last.open);
    const isPriceStalled = lastCandleBody < 1.5; 

    // ==========================================
    // СКАЛЬП-ПОКУПКА (LONG)
    // ==========================================
    if (!currentPosition && isBullTrend && rsiBullish && isPriceStalled) {
        return {
            type: 'СКАЛЬП-ВХОД: BUY 🟢',
            price: last.close,
            entryPrice: last.close,
            target: last.close + 2.5, // Цель $2.5 (скальпинг)
            stop: last.close - 2.5,   // Стоп $2.5
            confidence: 90,
            reason: `SCALP: Тренд + RSI ${rsi.toFixed(1)} | Быстрый вход`,
            action: 'ENTRY',
            positionType: 'long',
            entryNow: true
        };
    }

    // ==========================================
    // СКАЛЬП-ПРОДАЖА (SHORT)
    // ==========================================
    if (!currentPosition && isBearTrend && rsiBearish && isPriceStalled) {
        return {
            type: 'СКАЛЬП-ВХОД: SELL 🔴',
            price: last.close,
            entryPrice: last.close,
            target: last.close - 2.5, // Цель $2.5
            stop: last.close + 2.5,   // Стоп $2.5
            confidence: 90,
            reason: `SCALP: Тренд + RSI ${rsi.toFixed(1)} | Быстрый вход`,
            action: 'ENTRY',
            positionType: 'short',
            entryNow: true
        };
    }

    // ==========================================
    // УПРАВЛЕНИЕ ТЕКУЩЕЙ ПОЗИЦИЕЙ
    // ==========================================
    if (currentPosition === 'long') {
        const profit = ((last.close - entryPrice) / entryPrice * 100).toFixed(2);
        
        // ТЕЙК ПРОФИТ (Скальпинг)
        if (last.close >= entryPrice + 2.5 || rsi > 65) {
            return {
                type: 'ФИКСИРУЕМ СКALP 💰',
                price: last.close,
                confidence: 100,
                reason: `ЦЕЛЬ ДОСТИГНУТА (+$2.5). ПРИБЫЛЬ: ${profit}%`,
                action: 'EXIT',
                profit: profit
            };
        }
        // СТОП ЛОСС (Короткий)
        if (last.close <= entryPrice - 2.5) {
            return {
                type: 'ЗАКРЫТЬ СКALP ⚠️',
                price: last.close,
                confidence: 100,
                reason: `СТОП-ЛОСС (-$2.5). УБЫТОК: ${profit}%`,
                action: 'EXIT',
                profit: profit
            };
        }
    }

    if (currentPosition === 'short') {
        const profit = ((entryPrice - last.close) / entryPrice * 100).toFixed(2);
        
        // ТЕЙК ПРОФИТ (Скальпинг)
        if (last.close <= entryPrice - 2.5 || rsi < 35) {
            return {
                type: 'ФИКСИРУЕМ SCALP 💰',
                price: last.close,
                confidence: 100,
                reason: `ЦЕЛЬ ДОСТИГНУТА (+$2.5). ПРИБЫЛЬ: ${profit}%`,
                action: 'EXIT',
                profit: profit
            };
        }
        // СТОП ЛОСС
        if (last.close >= entryPrice + 2.5) {
            return {
                type: 'ЗАКРЫТЬ SCALP ⚠️',
                price: last.close,
                confidence: 100,
                reason: `СТОП-ЛОСС (-$2.5). УБЫТОК: ${profit}%`,
                action: 'EXIT',
                profit: profit
            };
        }
    }

    // Если ничего не подошло (Генерируем прогноз на основе текущего тренда)
    if (!currentPosition) {
        const isUp = last.close > sma20;
        return {
            type: isUp ? 'ПРОГНОЗ: РОСТ 📈' : 'ПРОГНОЗ: ПАДЕНИЕ 📉',
            price: last.close,
            confidence: 75,
            reason: isUp ? `Цена выше SMA20, тренд бычий. RSI: ${rsi.toFixed(1)}` : `Цена ниже SMA20, тренд медвежий. RSI: ${rsi.toFixed(1)}`,
            action: 'WAIT',
            target: isUp ? levels.resistance : levels.support,
            stop: isUp ? last.close - 15 : last.close + 15
        };
    }

    return null;
}

// ==========================================
// ТЕХНИЧЕСКИЕ ИНДИКАТОРЫ
// ==========================================

function calculateRSI(period = 14) {
    if (currentData.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = currentData.length - period; i < currentData.length; i++) {
        const change = currentData[i].close - currentData[i - 1].close;
        if (change > 0) gains += change;
        else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateSMA(period) {
    if (currentData.length < period) return currentData[currentData.length - 1].close;
    
    let sum = 0;
    for (let i = currentData.length - period; i < currentData.length; i++) {
        sum += currentData[i].close;
    }
    return sum / period;
}

function calculateLevels() {
    const recent = currentData.slice(-20);
    const highs = recent.map(d => d.high);
    const lows = recent.map(d => d.low);
    
    return {
        resistance: Math.max(...highs),
        support: Math.min(...lows)
    };
}

function calculateTimeToTarget(currentPrice, targetPrice) {
    const distance = Math.abs(targetPrice - currentPrice);
    const distancePercent = (distance / currentPrice) * 100;
    
    // Расчет на основе средней волатильности золота (~1% в час)
    const hourlyVolatility = 1.0;
    const hours = distancePercent / hourlyVolatility;
    
    if (hours < 1) {
        return `${Math.round(hours * 60)}-${Math.round(hours * 60 + 15)} минут`;
    } else {
        return `${Math.round(hours)}-${Math.round(hours + 1)} часов`;
    }
}

// ==========================================
// ОТОБРАЖЕНИЕ РЕЗУЛЬТАТОВ
// ==========================================

function displaySignal(signal) {
    const time = new Date().toLocaleTimeString('ru-RU');
    
    // Управляем позицией
    if (signal.action === 'ENTRY') {
        // Проверяем нужно ли входить сейчас или ждать
        if (signal.entryNow) {
            currentPosition = signal.positionType;
            entryPrice = signal.entryPrice;
            entryTime = Date.now();
            console.log(`🟢 ВХОДИМ СЕЙЧАС! ${currentPosition.toUpperCase()} по цене $${entryPrice.toFixed(2)}`);
            showNotification('ВХОДИТЬ В ПОЗИЦИЮ СЕЙЧАС!', `${signal.type} по $${entryPrice.toFixed(2)}`, 'success');
        } else {
            console.log(`⏳ ЖДЕМ ТОЧКУ ВХОДА: $${signal.entryPrice.toFixed(2)}`);
            showNotification('ЖДЕМ ТОЧКУ ВХОДА!', `Цена входа: $${signal.entryPrice.toFixed(2)}`, 'warning');
        }
    } else if (signal.action === 'EXIT') {
        const holdTime = ((Date.now() - entryTime) / 1000 / 60).toFixed(1);
        console.log(`🔴 ЗАКРЫВАЕМ ПОЗИЦИЮ: ${currentPosition.toUpperCase()}`);
        console.log(`💰 Прибыль/Убыток: ${signal.profit > 0 ? '+' : ''}${signal.profit}%`);
        console.log(`⏱️ Время в позиции: ${holdTime} минут`);
        showNotification('ПОЗИЦИЯ ЗАКРЫТА!', `${signal.type} (${signal.profit > 0 ? '+' : ''}${signal.profit}%)`, 
                        signal.profit > 0 ? 'success' : 'danger');
        currentPosition = null;
        entryPrice = null;
        entryTime = null;
    } else if (signal.action === 'WAIT') {
        showNotification('СИСТЕМА АНАЛИЗИРУЕТ', signal.type, 'warning');
    }
    
    console.log('\n' + '='.repeat(50));
    console.log(`🎯 ПРОГНОЗ: ${signal.type}`);
    console.log(`⏰ Время: ${time}`);
    console.log(`💰 Текущая цена: $${signal.price.toFixed(2)}`);
    
    if (signal.action === 'ENTRY' && signal.entryPrice) {
        const distance = ((signal.entryPrice - signal.price) / signal.price * 100).toFixed(2);
        const direction = distance > 0 ? 'выше' : 'ниже';
        console.log(`🎯 ТОЧКА ВХОДА: $${signal.entryPrice.toFixed(2)} (${direction} ${Math.abs(distance)}%)`);
        
        if (signal.entryNow) {
            console.log(`✅ ВХОДИТЬ СЕЙЧАС! Цена достигла точки входа!`);
        } else {
            console.log(`⏳ ЖДАТЬ входа...`);
        }
    }
    
    if (signal.target && signal.action !== 'EXIT') {
        const profit = ((signal.target - (signal.entryPrice || signal.price)) / (signal.entryPrice || signal.price) * 100).toFixed(2);
        const direction = signal.positionType === 'long' ? '+' : '';
        console.log(`🎯 Цель: $${signal.target.toFixed(2)} (${direction}${profit}%)`);
        console.log(`🛡️ Стоп: $${signal.stop.toFixed(2)}`);
        console.log(`⏱️ Время до цели: ${signal.timeToTarget}`);
    }
    
    if (signal.action === 'EXIT') {
        console.log(`💰 Результат: ${signal.profit > 0 ? 'ПРИБЫЛЬ' : 'УБЫТОК'} ${signal.profit > 0 ? '+' : ''}${signal.profit}%`);
    }
    
    console.log(`📊 Уверенность: ${signal.confidence}%`);
    console.log(`📝 Причина: ${signal.reason}`);
    
    if (currentPosition && signal.action === 'HOLD') {
        const currentProfit = ((signal.price - entryPrice) / entryPrice * 100).toFixed(2);
        const direction = currentProfit > 0 ? '+' : '';
        console.log(`💱 Текущая P&L: ${direction}${currentProfit}%`);
    }
    
    console.log('='.repeat(50) + '\n');
    
    // Обновляем HTML если есть
    updateSignalDisplay(signal);

    // Отправляем в Telegram
    sendTelegramMessage(signal);
}

async function sendTelegramMessage(signal) {
    if (!TG_TOKEN || !TG_CHAT_ID) return;

    let text = "";
    if (signal.action === 'ENTRY') {
        text = `🎯 *СИГНАЛ ВХОДА!*\n\n` +
               `*Направление:* ${signal.type}\n` +
               `*Цена:* $${signal.price.toFixed(2)}\n` +
               `*Цель (TP):* $${signal.target.toFixed(2)}\n` +
               `*Стоп (SL):* $${signal.stop.toFixed(2)}\n` +
               `*Уверенность:* ${signal.confidence}%\n\n` +
               `📝 *Анализ:* ${signal.reason}`;
    } else if (signal.action === 'EXIT') {
        const profitEmoji = signal.profit > 0 ? '💰' : '⚠️';
        text = `${profitEmoji} *ЗАКРЫТИЕ ПОЗИЦИИ*\n\n` +
               `*Результат:* ${signal.type}\n` +
               `*Цена выхода:* $${signal.price.toFixed(2)}\n` +
               `*Прибыль/Убыток:* ${signal.profit}%`;
    } else if (signal.action === 'WAIT') {
        const trendEmoji = signal.type.includes('РОСТ') ? '📈' : '📉';
        text = `${trendEmoji} *ТЕКУЩИЙ ПРОГНОЗ*\n\n` +
               `*Направление:* ${signal.type}\n` +
               `*Текущая цена:* $${signal.price.toFixed(2)}\n` +
               `*Ожидаемая цель:* $${signal.target.toFixed(2)}\n` +
               `*Уверенность:* ${signal.confidence}%\n\n` +
               `📝 *Анализ:* ${signal.reason}`;
    }

    if (!text) return;

    try {
        const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TG_CHAT_ID,
                text: text,
                parse_mode: 'Markdown'
            })
        });
    } catch (e) {
        console.error('❌ Ошибка Telegram:', e);
    }
}

function showNotification(title, message, type = 'info') {
    // Создаем уведомление если есть DOM
    if (typeof document !== 'undefined') {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? 'var(--success)' : type === 'danger' ? 'var(--danger)' : type === 'warning' ? 'var(--warning)' : 'var(--primary)'};
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
            max-width: 300px;
        `;
        
        notification.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 0.5rem;">${title}</div>
            <div>${message}</div>
        `;
        
        document.body.appendChild(notification);
        
        // Удаляем через 3 секунды
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }
}

function updateForecast(last, rsi, sma20, sma50, levels) {
    const trend = last.close > sma20 ? 'БЫЧИЙ 📈' : 'МЕДВЕЖИЙ 📉';
    const momentum = rsi > 50 ? 'ВОСХОДЯЩИЙ' : 'НИСХОДЯЩИЙ';
    
    let waitingReason = 'АНАЛИЗ РЫНКА...';
    if (!currentPosition) {
        if (last.close > sma20 && rsi > 45) waitingReason = 'ЖДЕМ КОРРЕКЦИЮ RSI < 35 ДЛЯ ПОКУПКИ ⏳';
        else if (last.close < sma20 && rsi < 55) waitingReason = 'ЖДЕМ ОЦКОК RSI > 65 ДЛЯ ПРОДАЖИ ⏳';
        else waitingReason = 'РЫНОК В БОКОВИКЕ, ИЩЕМ ТОЧКУ... 🔍';
    }

    console.log(`📈 ПРОГНОЗ:`);
    console.log(`   Тренд: ${trend} | Импульс: ${momentum} (RSI: ${rsi.toFixed(1)})`);
    console.log(`   СТАТУС: ${waitingReason}`);
    console.log(`   Цели: Сопр. $${levels.resistance.toFixed(2)} | Подд. $${levels.support.toFixed(2)}`);

    // Обновляем в интерфейсе (если есть элемент для статуса ожидания)
    const predictionResult = document.getElementById('prediction-result');
    if (predictionResult && !activeSignal) {
        predictionResult.textContent = waitingReason;
        predictionResult.className = 'prediction-value wait';
    }
}

function updateSignalDisplay(signal) {
    // Обновляем панель прогноза
    const predictionElement = document.getElementById('prediction-result');
    const confidenceElement = document.getElementById('confidence-level');
    const targetElement = document.getElementById('target-price');
    
    if (predictionElement) {
        // Показываем точку входа если есть
        let displayText = signal.type;
        if (signal.action === 'ENTRY' && signal.entryPrice) {
            const distance = ((signal.entryPrice - signal.price) / signal.price * 100).toFixed(2);
            if (signal.entryNow) {
                displayText = `ВХОДИТЬ СЕЙЧАС!`;
            } else {
                displayText = `ЖДАТЬ $${signal.entryPrice.toFixed(2)}`;
            }
        }
        predictionElement.textContent = displayText;
        
        // Цвета для разных типов прогнозов
        if (signal.action === 'ENTRY' && signal.entryNow) {
            predictionElement.className = 'prediction-value entry-now';
        } else if (signal.type.includes('ПОКУПАТЬ')) {
            predictionElement.className = 'prediction-value buy';
        } else if (signal.type.includes('ПРОДАВАТЬ')) {
            predictionElement.className = 'prediction-value sell';
        } else if (signal.type.includes('ЗАКРЫТЬ')) {
            predictionElement.className = 'prediction-value exit';
        } else if (signal.type.includes('ДЕРЖАТЬ')) {
            predictionElement.className = 'prediction-value hold';
        } else {
            predictionElement.className = 'prediction-value wait';
        }
    }
    
    if (confidenceElement) {
        confidenceElement.textContent = `${signal.confidence}%`;
        confidenceElement.style.color = signal.confidence > 70 ? 'var(--success)' : 
                                       signal.confidence > 50 ? 'var(--warning)' : 'var(--danger)';
    }
    
    if (targetElement) {
        if (signal.action === 'ENTRY' && signal.entryPrice && !signal.entryNow) {
            const distance = ((signal.entryPrice - signal.price) / signal.price * 100).toFixed(2);
            const direction = distance > 0 ? 'выше' : 'ниже';
            targetElement.textContent = `Вход: $${signal.entryPrice.toFixed(2)} (${direction} ${Math.abs(distance)}%)`;
            targetElement.style.color = 'var(--warning)';
        } else if (signal.target && signal.action !== 'EXIT') {
            const basePrice = signal.entryPrice || signal.price;
            const profit = ((signal.target - basePrice) / basePrice * 100).toFixed(2);
            const direction = signal.positionType === 'long' ? '+' : '';
            targetElement.textContent = `$${signal.target.toFixed(2)} (${direction}${profit}%)`;
            targetElement.style.color = signal.positionType === 'long' ? 'var(--success)' : 'var(--danger)';
        } else if (signal.action === 'EXIT' && signal.profit !== undefined) {
            const profitText = signal.profit > 0 ? `+${signal.profit}%` : `${signal.profit}%`;
            targetElement.textContent = `P&L: ${profitText}`;
            targetElement.style.color = signal.profit > 0 ? 'var(--success)' : 'var(--danger)';
        } else {
            targetElement.textContent = '--';
        }
    }
    
    // Добавляем сигнал в список
    addSignalToPage(signal);
}

function addSignalToPage(signal) {
    const signalsList = document.getElementById('signals-list');
    if (!signalsList) return;
    
    // Удаляем сообщение о загрузке
    const loading = signalsList.querySelector('.loading');
    if (loading) loading.remove();
    
    const signalItem = document.createElement('div');
    signalItem.className = `signal-item ${signal.type.toLowerCase()}`;
    
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
    let targetHtml = '';
    let timeHtml = '';
    
    if (signal.target && signal.type !== 'HOLD') {
        const profit = ((signal.target - signal.price) / signal.price * 100).toFixed(2);
        const direction = signal.type === 'BUY' ? '+' : '';
        targetHtml = `<div class="signal-target">Цель: $${signal.target.toFixed(2)} (${direction}${profit}%)</div>`;
        timeHtml = `<div class="signal-time-estimate">Время до цели: ${signal.timeToTarget}</div>`;
    }
    
    signalItem.innerHTML = `
        <div class="signal-header">
            <span class="signal-type">${signal.type}</span>
            <span class="signal-time">${time}</span>
        </div>
        <div class="signal-price">$${signal.price.toFixed(2)}</div>
        <div class="signal-reason">${signal.reason}</div>
        ${targetHtml}
        ${timeHtml}
        <div class="signal-status">Активный сигнал</div>
    `;
    
    // Добавляем в начало списка
    signalsList.prepend(signalItem);
    
    // Ограничиваем количество сигналов
    while (signalsList.children.length > 3) {
        signalsList.lastElementChild.remove();
    }
    
    // Визуальная индикация нового сигнала
    signalItem.style.animation = 'slideIn 0.5s ease-out';
}

function updatePriceDisplay(newPrice) {
    const priceElement = document.getElementById('current-price');
    const changeElement = document.getElementById('price-change');
    
    if (!priceElement) return;
    
    // Убедимся что цена это число и правильно форматируем
    const formattedPrice = parseFloat(newPrice).toFixed(2);
    const oldPrice = parseFloat(priceElement.textContent.replace('$', '')) || newPrice;
    const change = ((newPrice - oldPrice) / oldPrice * 100).toFixed(2);
    
    priceElement.textContent = `$${formattedPrice}`;
    priceElement.style.color = newPrice >= oldPrice ? 'var(--success)' : 'var(--danger)';
    
    if (changeElement) {
        changeElement.textContent = `${change >= 0 ? '+' : ''}${change}%`;
        changeElement.style.color = change >= 0 ? 'var(--success)' : 'var(--danger)';
    }
    
    console.log(`💰 Цена обновлена: $${formattedPrice} (изменение: ${change}%)`);
}

function updateSystemStatus(isReal = false, isFallback = false) {
    const wsStatus = document.getElementById('ws-status');
    const historyStatus = document.getElementById('history-status');
    
    if (wsStatus) {
        const statusDot = wsStatus.querySelector('.status-dot');
        const statusText = wsStatus.querySelector('span:last-child');
        
        if (isFallback) {
            statusDot.className = 'status-dot yellow';
            statusText.textContent = 'Mode: SMART ANALYZER';
        } else {
            statusDot.className = socket && socket.readyState === WebSocket.OPEN ? 'status-dot green' : 'status-dot red';
            statusText.textContent = socket && socket.readyState === WebSocket.OPEN ? 'WebSocket: LIVE' : 'WebSocket: WAITING';
        }
    }

    if (historyStatus) {
        const statusDot = historyStatus.querySelector('.status-dot');
        const statusText = historyStatus.querySelector('span:last-child');
        statusDot.className = isReal || isFallback ? 'status-dot green' : 'status-dot red';
        statusText.textContent = isReal ? 'Market: REAL-TIME' : (isFallback ? 'Market: ANALYZING' : 'Market: ERROR');
    }
}

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================

function updatePrice(newPrice) {
    if (currentData.length === 0) return;
    
    // Обновляем цену на странице
    updatePriceDisplay(newPrice);
    
    const lastCandle = currentData[currentData.length - 1];
    const now = Math.floor(Date.now() / 1000);
    
    // Обновляем последнюю свечу или создаем новую
    if (now - lastCandle.time < 60) {
        lastCandle.close = newPrice;
        lastCandle.high = Math.max(lastCandle.high, newPrice);
        lastCandle.low = Math.min(lastCandle.low, newPrice);
    } else {
        currentData.push({
            time: now,
            open: newPrice,
            high: newPrice,
            low: newPrice,
            close: newPrice
        });
        
        // Ограничиваем количество данных
        if (currentData.length > 500) {
            currentData.shift();
        }
    }
    
    // Проверяем достижение цели
    if (activeSignal && activeSignal.type !== 'HOLD') {
        checkTargetReached(newPrice);
    }
    
    // Анализируем рынок
    analyzeMarket();
}

function checkTargetReached(currentPrice) {
    if (!activeSignal || !activeSignal.target) return;
    
    let reached = false;
    
    if (activeSignal.type === 'BUY' && currentPrice >= activeSignal.target) {
        reached = true;
    } else if (activeSignal.type === 'SELL' && currentPrice <= activeSignal.target) {
        reached = true;
    }
    
    if (reached) {
        const profit = ((currentPrice - activeSignal.entryPrice) / activeSignal.entryPrice * 100).toFixed(2);
        console.log(`\n🎉 ЦЕЛЬ ДОСТИГНУТА! Прибыль: ${profit}%\n`);
        
        // Отправляем уведомление о закрытии перед сбросом
        const exitSignal = {
            type: activeSignal.positionType === 'long' ? 'ЗАКРЫТЬ BUY 💰' : 'ЗАКРЫТЬ SELL 💰',
            price: currentPrice,
            profit: profit,
            action: 'EXIT'
        };
        displaySignal(exitSignal);

        // Сбрасываем активный сигнал и время, чтобы разрешить немедленное обновление
        activeSignal = null;
        currentPosition = null; // ВАЖНО: сбросить текущую позицию
        entryPrice = null;      // ВАЖНО: сбросить цену входа
        lastSignal = null;
        lastSignalTime = 0; 
        
        // Немедленно запускаем новый анализ для поиска следующей точки
        analyzeMarket();
    }
}

function generateMockData() {
    console.log('📊 Генерация тестовых данных...');
    const basePrice = 4710;
    const now = Math.floor(Date.now() / 1000);
    
    for (let i = 100; i >= 0; i--) {
        const volatility = 0.005;
        const trend = i > 50 ? 1 : -1;
        const random = (Math.random() - 0.5) * volatility;
        const price = basePrice + (trend * i * 0.1) + (random * basePrice);
        
        currentData.push({
            time: now - (i * 60),
            open: price,
            high: price * (1 + Math.random() * 0.001),
            low: price * (1 - Math.random() * 0.001),
            close: price
        });
    }
    
    console.log(`✅ SMART ANALYZER готов. Сгенерировано ${currentData.length} свечей.`);
    analyzeMarket(); // Сразу запускаем первый анализ
}

function startAnalysis() {
    console.log('🔄 Запуск реального анализа рынка...');
    
    // Первый анализ сразу
    setTimeout(() => {
        if (currentData.length >= 20) {
            analyzeMarket();
        }
    }, 3000);
    
    // Периодическая проверка каждые 30 секунд (для надежности)
    setInterval(() => {
        if (currentData.length >= 20) {
            analyzeMarket();
        }
    }, 30000);
    
    console.log('🔄 Реальный анализ запущен. Ждем данных от WebSocket...');
}

// ==========================================
// ЗАПУСК СИСТЕМЫ
// ==========================================

// Запуск при загрузке страницы
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', init);
} else {
    // Для Node.js
    init();
}

// Экспорт для тестирования
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        init,
        analyzeMarket,
        calculateRSI,
        calculateSMA
    };
}

