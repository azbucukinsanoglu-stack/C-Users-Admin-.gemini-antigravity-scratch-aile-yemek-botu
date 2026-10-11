// ============================================================
//  Aile Şefi 👨‍🍳  —  Akıllı Aile Yemek Tarifi Asistanı
//  Gemini API ile internetten tarif bulan PWA chatbot
// ============================================================

(function () {
    'use strict';

    // ─── State Machine ───────────────────────────────────────
    const STATE = {
        INIT:             'INIT',
        ASK_COUNT:        'ASK_COUNT',
        ASK_NAME:         'ASK_NAME',
        ASK_RESTRICTION:  'ASK_RESTRICTION',
        ASK_INGREDIENTS:  'ASK_INGREDIENTS',
        CONFIRM:          'CONFIRM',
        SEARCHING:        'SEARCHING',
        DONE:             'DONE'
    };

    // ─── App Data ────────────────────────────────────────────
    let state = STATE.INIT;
    let familyCount = 0;
    let currentMemberIndex = 0;
    let familyMembers = [];     // [{ name: string, restrictions: string }]
    let ingredients = [];
    let apiKey = localStorage.getItem('aile_sefi_api_key') || '';
    let model = localStorage.getItem('aile_sefi_model') || 'gemini-3.8-flash';

    // ─── DOM References ──────────────────────────────────────
    const messagesEl       = document.getElementById('messages');
    const chatContainer    = document.getElementById('chat-container');
    const userInput        = document.getElementById('userInput');
    const sendBtn          = document.getElementById('sendBtn');
    const resetBtn         = document.getElementById('resetBtn');
    const settingsBtn      = document.getElementById('settingsBtn');
    const settingsModal    = document.getElementById('settingsModal');
    const modalOverlay     = document.getElementById('modalOverlay');
    const closeModalBtn    = document.getElementById('closeModal');
    const apiKeyInput      = document.getElementById('apiKeyInput');
    const modelSelect      = document.getElementById('modelSelect');
    const saveSettingsBtn  = document.getElementById('saveSettings');
    const toggleKeyBtn     = document.getElementById('toggleKeyVisibility');
    const quickRepliesEl   = document.getElementById('quick-replies');
    const statusText       = document.getElementById('statusText');
    const installBanner    = document.getElementById('installBanner');
    const installBtn       = document.getElementById('installBtn');
    const dismissInstallBtn= document.getElementById('dismissInstall');

    // ─── PWA Install Prompt ──────────────────────────────────
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBanner.classList.remove('hidden');
    });

    installBtn?.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const result = await deferredPrompt.userChoice;
            if (result.outcome === 'accepted') {
                installBanner.classList.add('hidden');
            }
            deferredPrompt = null;
        }
    });

    dismissInstallBtn?.addEventListener('click', () => {
        installBanner.classList.add('hidden');
    });

    // ─── Service Worker Registration ─────────────────────────
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // ─── Utilities ───────────────────────────────────────────
    function getTime() {
        return new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        });
    }

    function setInputEnabled(enabled) {
        userInput.disabled = !enabled;
        sendBtn.disabled = !enabled;
        if (enabled) {
            userInput.focus();
        }
    }

    // ─── Message Rendering ───────────────────────────────────
    function addMessage(text, sender = 'bot', isHTML = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = sender === 'bot' ? '👨‍🍳' : '👤';

        const contentWrap = document.createElement('div');

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        if (isHTML) {
            bubble.innerHTML = text;
        } else {
            bubble.textContent = text;
        }

        const time = document.createElement('div');
        time.className = 'message-time';
        time.textContent = getTime();

        contentWrap.appendChild(bubble);
        contentWrap.appendChild(time);

        msgDiv.appendChild(avatar);
        msgDiv.appendChild(contentWrap);

        // Remove typing indicator if present
        removeTypingIndicator();

        messagesEl.appendChild(msgDiv);
        scrollToBottom();

        return msgDiv;
    }

    function addBotMessage(text, isHTML = false) {
        return addMessage(text, 'bot', isHTML);
    }

    function addUserMessage(text) {
        return addMessage(text, 'user');
    }

    // ─── Typing Indicator ────────────────────────────────────
    function showTypingIndicator() {
        removeTypingIndicator();
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message bot';
        msgDiv.id = 'typing-indicator';

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = '👨‍🍳';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

        msgDiv.appendChild(avatar);
        msgDiv.appendChild(bubble);
        messagesEl.appendChild(msgDiv);
        scrollToBottom();
    }

    function removeTypingIndicator() {
        const existing = document.getElementById('typing-indicator');
        if (existing) existing.remove();
    }

    // ─── Quick Reply Buttons ─────────────────────────────────
    function showQuickReplies(options) {
        quickRepliesEl.innerHTML = '';
        quickRepliesEl.classList.remove('hidden');
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'quick-reply-btn';
            btn.textContent = opt;
            btn.addEventListener('click', () => {
                quickRepliesEl.classList.add('hidden');
                handleUserInput(opt);
            });
            quickRepliesEl.appendChild(btn);
        });
        scrollToBottom();
    }

    function hideQuickReplies() {
        quickRepliesEl.classList.add('hidden');
        quickRepliesEl.innerHTML = '';
    }

    // ─── Delayed Bot Message (simulates typing) ─────────────
    function botSay(text, delay = 600, isHTML = false) {
        return new Promise((resolve) => {
            showTypingIndicator();
            setTimeout(() => {
                addBotMessage(text, isHTML);
                resolve();
            }, delay);
        });
    }

    // ─── State Handlers ──────────────────────────────────────

    async function startConversation() {
        state = STATE.INIT;
        familyCount = 0;
        currentMemberIndex = 0;
        familyMembers = [];
        ingredients = [];
        messagesEl.innerHTML = '';
        hideQuickReplies();

        await botSay('Merhaba! Ben Aile Şefi 👨‍🍳\n\nAilenizin damak tadına uygun, evdeki malzemelerle yapabileceğiniz tarifler bulmak için buradayım!', 800);

        if (!apiKey) {
            await botSay('⚠️ Önce bir Gemini API anahtarı girmeniz gerekiyor.\n\nSağ üstteki ⚙️ simgesine tıklayın ve ücretsiz API anahtarınızı kaydedin.', 1000);
        }

        await botSay('Aileniz toplam kaç kişi?', 600);
        state = STATE.ASK_COUNT;
        showQuickReplies(['2', '3', '4', '5', '6']);
        setInputEnabled(true);
    }

    function handleCount(text) {
        const num = parseInt(text.trim());
        if (isNaN(num) || num < 1 || num > 30) {
            botSay('Lütfen 1 ile 30 arasında geçerli bir sayı girin. 😊');
            return;
        }
        familyCount = num;
        currentMemberIndex = 0;
        familyMembers = [];
        state = STATE.ASK_NAME;
        botSay(`Harika! ${familyCount} kişilik bir aile. 🏠\n\n1. aile üyesinin adı nedir?`);
    }

    function handleName(text) {
        const name = text.trim();
        if (!name || name.length > 50) {
            botSay('Lütfen geçerli bir isim girin.');
            return;
        }
        familyMembers.push({ name, restrictions: '' });
        state = STATE.ASK_RESTRICTION;
        botSay(`${name} ne yemez veya nelere alerjisi var?\n\nÖrnek: süt ürünleri, fıstık, et, gluten...\n(Kısıtlaması yoksa "yok" yazın)`, 500);
        showQuickReplies(['Yok', 'Et yemez', 'Süt ürünleri', 'Gluten', 'Deniz ürünleri', 'Fıstık/Kuruyemiş']);
    }

    function handleRestriction(text) {
        familyMembers[currentMemberIndex].restrictions = text.trim();
        currentMemberIndex++;
        hideQuickReplies();

        if (currentMemberIndex < familyCount) {
            state = STATE.ASK_NAME;
            botSay(`✅ Tamam!\n\n${currentMemberIndex + 1}. aile üyesinin adı nedir?`, 500);
        } else {
            // All members entered, show summary
            state = STATE.ASK_INGREDIENTS;

            let summaryHTML = '<div class="summary-card"><strong>👨‍👩‍👧‍👦 Aile Üyeleri:</strong><br><br>';
            familyMembers.forEach((m, i) => {
                const restriction = m.restrictions.toLowerCase() === 'yok'
                    ? '✅ Kısıtlama yok'
                    : `🚫 ${m.restrictions}`;
                summaryHTML += `<div class="member-item"><span>${i + 1}. ${m.name}</span><span>${restriction}</span></div>`;
            });
            summaryHTML += '</div>';

            botSay(summaryHTML, 600, true).then(() => {
                botSay('Şimdi evde bulunan malzemeleri yazın.\n\nVirgülle ayırarak yazabilirsiniz.\nÖrnek: tavuk, pirinç, soğan, domates, biber', 800);
            });
        }
    }

    function handleIngredients(text) {
        // Parse ingredients separated by comma, semicolon, or newline
        ingredients = text
            .split(/[,;،\n]+/)
            .map(i => i.trim())
            .filter(i => i.length > 0);

        if (ingredients.length === 0) {
            botSay('Lütfen en az bir malzeme girin. Virgülle ayırabilirsiniz.');
            return;
        }

        state = STATE.CONFIRM;

        let ingredientList = '📦 **Evdeki Malzemeler:**\n\n';
        ingredients.forEach(i => {
            ingredientList += `  • ${i}\n`;
        });
        ingredientList += `\nToplam: ${ingredients.length} malzeme`;

        botSay(ingredientList, 500).then(() => {
            botSay('Bu bilgilerle size bir tarif bulayım mı? 🍳', 500);
            showQuickReplies(['Evet, tarif bul! 🔍', 'Malzemeleri değiştir', 'Baştan başla']);
        });
    }

    async function handleConfirm(text) {
        hideQuickReplies();
        const lower = text.toLowerCase();

        if (lower.includes('evet') || lower.includes('bul') || lower.includes('ara') || lower === 'e') {
            await searchRecipe();
        } else if (lower.includes('değiştir') || lower.includes('malzeme')) {
            state = STATE.ASK_INGREDIENTS;
            botSay('Malzemeleri tekrar yazabilirsiniz:');
        } else if (lower.includes('baştan') || lower.includes('sıfır')) {
            startConversation();
        } else {
            botSay('Anlamadım. Tarif arayalım mı?');
            showQuickReplies(['Evet, tarif bul! 🔍', 'Malzemeleri değiştir', 'Baştan başla']);
        }
    }

    // ─── Gemini API Call ─────────────────────────────────────

    function buildPrompt() {
        const membersList = familyMembers
            .map(m => {
                const r = m.restrictions.toLowerCase() === 'yok'
                    ? 'Herhangi bir kısıtlaması yok'
                    : m.restrictions;
                return `  - ${m.name}: ${r}`;
            })
            .join('\n');

        return `Sen deneyimli bir Türk aşçısısın. Aşağıdaki bilgilere göre ailenin evdeki malzemelerle yapabileceği BİR yemek tarifi öner.

🏠 AİLE BİLGİLERİ:
Toplam kişi sayısı: ${familyCount}
Aile üyeleri ve yemek kısıtlamaları/alerjileri:
${membersList}

📦 EVDEKİ MALZEMELER:
${ingredients.join(', ')}

📌 KURALLAR:
1. Sadece verilen malzemelerin hepsi veya çoğuyla yapılabilecek bir yemek tarifi öner.
2. Hiçbir aile üyesinin YEMEDİĞİ veya ALERJİSİ olan malzemeleri KESİNLİKLE kullanma.
3. ${familyCount} kişilik porsiyon olacak şekilde malzeme miktarlarını ayarla.
4. Eğer eksik olan temel malzeme varsa (tuz, yağ, baharat gibi), bunları ayrıca belirt.
5. Tarifi Türkçe olarak, anlaşılır ve adım adım açıkla.

📋 ÇIKTI FORMATI (bu formatı aynen kullan):

🍽️ [Yemek Adı]

⏱️ Hazırlık: [süre] | 🔥 Pişirme: [süre] | 👥 ${familyCount} Kişilik

📋 Malzemeler:
• [malzeme 1] - [miktar]
• [malzeme 2] - [miktar]
...

👨‍🍳 Hazırlanışı:
1. [adım 1]
2. [adım 2]
...

💡 İpuçları:
• [ipucu 1]
• [ipucu 2]

🛒 Eksik Olabilecek Malzemeler:
• [varsa listele, yoksa "Tüm malzemeler elinizde!" yaz]`;
    }

    async function searchRecipe() {
        if (!apiKey) {
            await botSay('⚠️ Tarif aramak için bir Gemini API anahtarı gerekli.\n\nSağ üstteki ⚙️ simgesine tıklayarak ücretsiz API anahtarınızı girin.\n\n🔗 Ücretsiz API anahtarı almak için:\nhttps://aistudio.google.com/apikey');
            state = STATE.CONFIRM;
            showQuickReplies(['Evet, tarif bul! 🔍']);
            return;
        }

        state = STATE.SEARCHING;
        setInputEnabled(false);
        statusText.textContent = 'Tarif arıyor...';

        await botSay('🔍 İnternetten ailenize uygun bir tarif arıyorum...\n\n<span class="loading-spinner"></span> Lütfen bekleyin...', 400, true);

        const prompt = buildPrompt();
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature: 0.8,
                        maxOutputTokens: 2048,
                        topP: 0.95,
                        topK: 40
                    },
                    safetySettings: [
                        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                    ]
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMsg = errorData?.error?.message || `HTTP ${response.status}`;
                throw new Error(errorMsg);
            }

            const data = await response.json();

            if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                const recipe = data.candidates[0].content.parts[0].text;

                // Remove the loading message
                const lastMsg = messagesEl.lastElementChild;
                if (lastMsg) lastMsg.remove();

                addBotMessage('✅ İşte ailenize özel bir tarif buldum!\n\n' + recipe);

                state = STATE.DONE;
                statusText.textContent = 'Çevrimiçi';
                setInputEnabled(true);

                await botSay('Başka bir tarif denemek ister misiniz? 🍴', 800);
                showQuickReplies(['Başka tarif bul 🔍', 'Malzemeleri değiştir', 'Baştan başla 🔄']);
            } else {
                throw new Error('API yanıt vermedi. Lütfen tekrar deneyin.');
            }
        } catch (error) {
            removeTypingIndicator();
            // Remove loading message
            const lastMsg = messagesEl.lastElementChild;
            if (lastMsg && lastMsg.querySelector('.loading-spinner')) {
                lastMsg.remove();
            }

            let errorMessage = `❌ Hata oluştu: ${error.message}`;
            if (error.message.includes('API key')) {
                errorMessage += '\n\n🔑 API anahtarınızı kontrol edin. Geçersiz veya süresi dolmuş olabilir.';
            } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                errorMessage += '\n\n📡 İnternet bağlantınızı kontrol edin.';
            }

            await botSay(errorMessage);
            state = STATE.CONFIRM;
            statusText.textContent = 'Çevrimiçi';
            setInputEnabled(true);
            showQuickReplies(['Tekrar dene 🔄', 'Ayarları aç ⚙️']);
        }
    }

    // ─── Central Input Handler ───────────────────────────────

    async function handleUserInput(text) {
        if (!text || !text.trim()) return;

        text = text.trim();
        addUserMessage(text);
        hideQuickReplies();

        // Special commands
        if (text.toLowerCase() === 'ayarları aç ⚙️' || text.toLowerCase() === 'ayarlar') {
            openSettings();
            return;
        }

        switch (state) {
            case STATE.ASK_COUNT:
                handleCount(text);
                break;
            case STATE.ASK_NAME:
                handleName(text);
                break;
            case STATE.ASK_RESTRICTION:
                handleRestriction(text);
                break;
            case STATE.ASK_INGREDIENTS:
                handleIngredients(text);
                break;
            case STATE.CONFIRM:
                handleConfirm(text);
                break;
            case STATE.DONE:
                // Handle post-recipe actions
                const lower = text.toLowerCase();
                if (lower.includes('başka') || lower.includes('başka tarif') || lower.includes('tekrar')) {
                    state = STATE.CONFIRM;
                    handleConfirm('evet');
                } else if (lower.includes('malzeme') || lower.includes('değiştir')) {
                    state = STATE.ASK_INGREDIENTS;
                    botSay('Yeni malzemelerinizi yazın (virgülle ayırarak):');
                } else if (lower.includes('baştan') || lower.includes('sıfır') || lower.includes('yeni')) {
                    startConversation();
                } else {
                    botSay('Ne yapmak istersiniz? 😊');
                    showQuickReplies(['Başka tarif bul 🔍', 'Malzemeleri değiştir', 'Baştan başla 🔄']);
                }
                break;
            default:
                botSay('Bir sorun oluştu. Baştan başlıyoruz...');
                startConversation();
        }
    }

    // ─── Event Listeners ─────────────────────────────────────

    // Send message
    sendBtn.addEventListener('click', () => {
        const text = userInput.value;
        userInput.value = '';
        handleUserInput(text);
    });

    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = userInput.value;
            userInput.value = '';
            handleUserInput(text);
        }
    });

    // Reset
    resetBtn.addEventListener('click', () => {
        if (state === STATE.SEARCHING) return; // Don't reset during search
        startConversation();
    });

    // Settings
    function openSettings() {
        apiKeyInput.value = apiKey;
        modelSelect.value = model;
        settingsModal.classList.remove('hidden');
    }

    function closeSettings() {
        settingsModal.classList.add('hidden');
    }

    settingsBtn.addEventListener('click', openSettings);
    closeModalBtn.addEventListener('click', closeSettings);
    modalOverlay.addEventListener('click', closeSettings);

    saveSettingsBtn.addEventListener('click', () => {
        const newKey = apiKeyInput.value.trim();
        const newModel = modelSelect.value;

        if (newKey) {
            apiKey = newKey;
            localStorage.setItem('aile_sefi_api_key', apiKey);
        }

        model = newModel;
        localStorage.setItem('aile_sefi_model', model);

        closeSettings();
        botSay('✅ Ayarlar kaydedildi!', 300);
    });

    // Toggle API key visibility
    toggleKeyBtn.addEventListener('click', () => {
        const input = apiKeyInput;
        if (input.type === 'password') {
            input.type = 'text';
            toggleKeyBtn.textContent = '🙈';
        } else {
            input.type = 'password';
            toggleKeyBtn.textContent = '👁️';
        }
    });

    // ─── Online/Offline Status ───────────────────────────────
    window.addEventListener('online', () => {
        statusText.textContent = 'Çevrimiçi';
    });

    window.addEventListener('offline', () => {
        statusText.textContent = 'Çevrimdışı';
    });

    // ─── Initialize ──────────────────────────────────────────
    startConversation();

})();
