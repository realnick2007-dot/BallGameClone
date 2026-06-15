(function(wHandle, wjQuery) {
    var CONNECTION_URL = location.hash.match(/[\w\d\.]+:\d+/) ? location.hash.slice(1) : "localhost:8080", // Default Connection
        SKIN_URL = "./skins/"; // Skin Directory

    wHandle.setserver = function(arg) {
        if (arg != CONNECTION_URL) {
            CONNECTION_URL = arg;
            showConnecting();
        }
    };

    var touchX, touchY,
        touchable = 'createTouch' in document,
        touches = [];

    var leftTouchID = -1,
        leftTouchPos = new Vector2(0, 0),
        leftTouchStartPos = new Vector2(0, 0),
        leftVector = new Vector2(0, 0);

    var useHttps = "https:" == wHandle.location.protocol;

    function flashGrowthSlot() {
        var el = document.getElementById('inv-slot-growth');
        if (!el) return;
        el.classList.remove('active');
        void el.offsetWidth;
        el.classList.add('active');
        setTimeout(function() {
            el.classList.remove('active');
        }, 400);
    }

    function gameLoop() {
        ma = true;
        document.getElementById("canvas").focus();
        var isTyping = false;
        var chattxt;
        mainCanvas = nCanvas = document.getElementById("canvas");
        ctx = mainCanvas.getContext("2d");

        mainCanvas.onmousemove = function(event) {
            rawMouseX = event.clientX;
            rawMouseY = event.clientY;
            mouseCoordinateChange()
        };

        if (touchable) {
            mainCanvas.addEventListener('touchstart', onTouchStart, false);
            mainCanvas.addEventListener('touchmove', onTouchMove, false);
            mainCanvas.addEventListener('touchend', onTouchEnd, false);
        }

        mainCanvas.onmouseup = function() {};
        if (/firefox/i.test(navigator.userAgent)) {
            document.addEventListener("DOMMouseScroll", handleWheel, false);
        } else {
            document.body.onmousewheel = handleWheel;
        }

        mainCanvas.onfocus = function() {
            isTyping = false;
        };

        document.getElementById("chat_textbox").onblur = function() {
            isTyping = false;
        };


        document.getElementById("chat_textbox").onfocus = function() {
            isTyping = true;
        };

        var spacePressed = false,
            qPressed = false,
            ePressed = false,
            rPressed = false,
            tPressed = false,
            pPressed = false,
            wPressed = false,
            gPressed = false,
            hPressed = false,
            threePressed = false;
        wHandle.onkeydown = function(event) {
            switch (event.keyCode) {
                case 13: // enter
                    if (isTyping || hideChat) {
                        isTyping = false;
                        document.getElementById("chat_textbox").blur();
                        chattxt = document.getElementById("chat_textbox").value;
                        if (chattxt.length > 0) sendChat(chattxt);
                        document.getElementById("chat_textbox").value = "";
                    } else {
                        if (!hasOverlay) {
                            document.getElementById("chat_textbox").focus();
                            isTyping = true;
                        }
                    }
                    break;
                case 32: // space
                    if ((!spacePressed) && (!isTyping)) {
                        sendMouseMove();
                        sendUint8(17);
                        spacePressed = true;
                    }
                    break;
                case 87: // W
                    if ((!wPressed) && (!isTyping)) {
                        sendMouseMove();
                        sendUint8(21);
                        wPressed = true;
                    }
                    break;
                case 81: // Q
                    if ((!qPressed) && (!isTyping)) {
                        sendUint8(18);
                        qPressed = true;
                    }
                    break;
                case 69: // E
                    if (!ePressed && (!isTyping)) {
                        sendMouseMove();
                        //sendUint8(22); 
                        sendUint8(26); //Recombine
                        ePressed = true;
                    }
                    break;
                case 82: // R
                    if (!rPressed && (!isTyping)) {
                        sendMouseMove();
                        sendUint8(23);
                        if (!rMacro) rPressed = true;
                    }
                    break;
                case 84: // T
                    if (!tPressed && (!isTyping)) {
                        sendMouseMove();
                        sendUint8(24);
                        tPressed = true;
                    }
                    break;
                case 80: // P
                    if (!pPressed && (!isTyping)) {
                        sendMouseMove();
                        sendUint8(25);
                        pPressed = true;
                    }
                    break;
                case 88: // X
                    if (!hPressed && (!isTyping)) {
                        sendMouseMove();
                        sendUint8(27); // Virus
                        hPressed = true;
                    }
                    break;
                case 71: // G
                    if (!gPressed && (!isTyping)) {
                        sendMouseMove();
                        //sendUint8(26);
                        sendUint8(22); // Bot split
                        gPressed = true;
                    }
                    break;
                case 51: // 3 — Growth Pellet
                    if (!threePressed && (!isTyping)) {
                        sendMouseMove();
                        sendUint8(28);
                        flashGrowthSlot();
                        threePressed = true;
                    }
                    break;
                case 27: // esc
                    showOverlays(true);
                    break;
            }
        };
        wHandle.onkeyup = function(event) {
            switch (event.keyCode) {
                case 32: // space
                    spacePressed = false;
                    break;
                case 87: // W
                    wPressed = false;
                    break;
                case 81: // Q
                    if (qPressed) {
                        sendUint8(19);
                        qPressed = false;
                    }
                    break;
                case 69:
                    ePressed = false;
                    break;
                case 82:
                    rPressed = false;
                    break;
                case 84:
                    tPressed = false;
                    break;
                case 80:
                    pPressed = false;
                    break;
                case 88:
                    hPressed = false;
                    break;
                case 71:
                    gPressed = false;
                    break;
                case 51: // 3
                    threePressed = false;
                    break;
            }
        };
        wHandle.onblur = function() {
            sendUint8(19);
            wPressed = spacePressed = qPressed = ePressed = rPressed = tPressed = pPressed = threePressed = false
        };

        wHandle.onresize = canvasResize;
        canvasResize();
        if (wHandle.requestAnimationFrame) {
            wHandle.requestAnimationFrame(redrawGameScene);
        } else {
            setInterval(drawGameScene, 1E3 / 60);
        }
        setInterval(sendMouseMove, 40);
        wsConnect();
        wjQuery("#overlays").hide();
    }

    function wsConnect() {
        if (ws) {
            ws.onopen = null;
            ws.onmessage = null;
            ws.onclose = null;
            try {
                ws.close()
            } catch (e) {}
            ws = null
        }
        CONNECTION_URL = $("#server").val();
        wjQuery("#connecting").show();
        ws = new WebSocket((useHttps ? "wss://" : "ws://") + CONNECTION_URL);
        ws.binaryType = "arraybuffer";
        ws.onopen = onWsOpen;
        ws.onmessage = onWsMessage;
        ws.onclose = onWsClose
    }

    function onTouchStart(e) {
        e.preventDefault();
        if (leftTouchID < 0) {
            var t = e.changedTouches[0];
            leftTouchID = t.identifier;
            leftTouchStartPos.reset(t.clientX, t.clientY);
            leftTouchPos.copyFrom(leftTouchStartPos);
            leftVector.reset(0, 0);
            return;
        }
        for (var i = 0; i < e.changedTouches.length; i++) {
            var t = e.changedTouches[i];
            if (leftTouchID != t.identifier && t.clientX > canvasWidth - 100 && t.clientY > canvasHeight - 100) {
                sendMouseMove();
                sendUint8(17);
                break;
            }
        }
    }

    function onTouchMove(e) {
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) {
            var t = e.changedTouches[i];
            if (leftTouchID == t.identifier) {
                leftTouchPos.reset(t.clientX, t.clientY);
                leftVector.copyFrom(leftTouchPos);
                leftVector.minusEq(leftTouchStartPos);
                rawMouseX = leftVector.x * 3 + canvasWidth / 2;
                rawMouseY = leftVector.y * 3 + canvasHeight / 2;
                mouseCoordinateChange();
                break;
            }
        }
    }

    function onTouchEnd(e) {
        for (var i = 0; i < e.changedTouches.length; i++) {
            var t = e.changedTouches[i];
            if (leftTouchID == t.identifier) {
                leftTouchID = -1;
                leftVector.reset(0, 0);
                rawMouseX = canvasWidth / 2;
                rawMouseY = canvasHeight / 2;
                mouseCoordinateChange();
                break;
            }
        }
    }

    function handleWheel(event) {
        zoom *= Math.pow(.9, event.wheelDelta / -120 || event.detail || 0);
        zoom = Math.max(zoom, 1);
        zoom = Math.min(zoom, 4)
    }

    function buildQTree() {
        if (.4 > viewZoom) qTree = null;
        else {
            var a = Number.POSITIVE_INFINITY,
                b = Number.POSITIVE_INFINITY,
                c = Number.NEGATIVE_INFINITY,
                d = Number.NEGATIVE_INFINITY,
                e = 0;
            for (var f = 0; f < nodes.length; f++) {
                for (var g = nodes[f], h = 0; h < g.points.length; ++h) {
                    var l = g.points[h].x,
                        m = g.points[h].y;
                    l < a && (a = l);
                    m < b && (b = m);
                    l > c && (c = l);
                    m > d && (d = m);
                    e = Math.max(g.size, e)
                }
            }
            qTree = Quad.init({
                minX: a - (e + 100),
                minY: b - (e + 100),
                maxX: c + (e + 100),
                maxY: d + (e + 100),
                maxChildren: 2,
                maxDepth: 4
            });
            for (f = 0; f < nodes.length; f++)
                if (g = nodes[f], 0 < g.points.length)
                    for (a = 0; a < g.points.length; ++a) qTree.insert(g.points[a])
        }
    }

    function mouseCoordinateChange() {
        X = (rawMouseX - canvasWidth / 2) / viewZoom + posX;
        Y = (rawMouseY - canvasHeight / 2) / viewZoom + posY
    }

    function hideOverlays() {
        hasOverlay = false;
        wjQuery("#overlays").hide();
    }

    function showOverlays(arg) {
        hasOverlay = true;
        userNickName = null;
        wjQuery("#overlays").fadeIn(arg ? 200 : 3E3);
    }

    function renderFood() {
        for (var a = 0; a < foods.length; a++) foods[a].draw();
    }

    function drawSplitIcon(ctx, images, icon, number, x, y) {
        // icon same size as number icon
        var size = 3 * images.width / 4;
        ctx.drawImage(icon, x + 3, y + 3, size, size);
        // draw number
        ctx.drawImage(images, x + 20, y, images.width, images.height);
    }

    function drawFood() {
        if (showFood) {
            for (var a = 0; a < foods.length; a++) foods[a].draw();
        }
    }

    function drawLine(ctx, x1, y1, x2, y2, thickness) {
        ctx.beginPath();
        ctx.lineWidth = thickness;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    function drawGrid() {
        ctx.save();
        ctx.strokeStyle = showDarkTheme ? "#AAAAAA" : "#000000";
        ctx.globalAlpha = showDarkTheme ? .2 : .1;
        ctx.scale(viewZoom, viewZoom);
        var a = canvasWidth / viewZoom,
            b = canvasHeight / viewZoom,
            c = -.5 + (-posX + a / 2) % 50,
            d = -.5 + (-posY + b / 2) % 50;
        for (var e = 0; c + e * 50 < a;)
            ctx.beginPath(),
            ctx.moveTo(c + e * 50, 0),
            ctx.lineTo(c + e * 50, b),
            ctx.stroke(),
            e++;
        for (e = 0; d + e * 50 < b;)
            ctx.beginPath(),
            ctx.moveTo(0, d + e * 50),
            ctx.lineTo(a, d + e * 50),
            ctx.stroke(),
            e++;
        ctx.restore()
    }

    function drawGameScene() {
        var a, oldtime = Date.now();
        timestamp = oldtime;
        if (0 < playerCells.length) {
            calcViewZoom();
            for (a = 0; a < playerCells.length; a++) playerCells[a].updatePos();
            posX = (posX + nodeX) / 2;
            posY = (posY + nodeY) / 2;
        } else {
            posX = (29 * posX + nodeX) / 30;
            posY = (29 * posY + nodeY) / 30;
            viewZoom = (9 * viewZoom + posSize * viewRange()) / 10;
        }
        buildQTree();
        mouseCoordinateChange();
        xa || ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        if (xa) {
            if (showDarkTheme) {
                ctx.fillStyle = '#111111';
                ctx.globalAlpha = .05;
                ctx.fillRect(0, 0, canvasWidth, canvasHeight);
                ctx.globalAlpha = 1;
            } else {
                ctx.fillStyle = '#F2FBFF';
                ctx.globalAlpha = .05;
                ctx.fillRect(0, 0, canvasWidth, canvasHeight);
                ctx.globalAlpha = 1;
            }
        } else {
            if (showDarkTheme) {
                ctx.fillStyle = '#111111';
                ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            } else {
                ctx.fillStyle = '#F2FBFF';
                ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            }
        }
        drawGrid();
        renderFood();
        drawFood();
        nodes.sort(function(a, b) {
            return a.size == b.size ? a.id - b.id : a.size - b.size
        });
        ctx.save();
        ctx.translate(canvasWidth / 2, canvasHeight / 2);
        ctx.scale(viewZoom, viewZoom);
        ctx.translate(-posX, -posY);
        for (a = 0; a < nodes.length; a++) nodes[a].draw();
        ctx.restore();
        lbCanvas && lbCanvas.width && ctx.drawImage(lbCanvas, canvasWidth - lbCanvas.width - 10, 10); // draw leaderboard
        chatCanvas && chatCanvas.width && ctx.drawImage(chatCanvas, 10, canvasHeight - chatCanvas.height - 50); // draw chat
        if (userScore) {
            if (null == scoreText || scoreText._value != userScore) scoreText = new UText(24, '#FFFFFF');
            scoreText.setValue('Score: ' + ~~(userScore / 100));
            a = scoreText.render();
            var b = a.width;
            ctx.globalAlpha = .2;
            ctx.fillStyle = '#000000';
            ctx.fillRect(10, canvasHeight - 10 - 24 - 10, b + 10, 34);
            ctx.globalAlpha = 1;
            ctx.drawImage(a, 15, canvasHeight - 10 - 24 - 5)
        }
        drawTouch();
    }

    function redrawGameScene() {
        drawGameScene();
        wHandle.requestAnimationFrame(redrawGameScene)
    }

    function hideConnecting() {
        wjQuery("#connecting").hide();
    }

    function showConnecting() {
        wjQuery("#connecting").show();
    }

    function wsSend(a) {
        if (ws && 1 == ws.readyState) {
            ws.send(a)
        }
    }

    function sendMouseMove() {
        var msg;
        if (wsIsOpen() && null != X && null != Y) {
            msg = new ArrayBuffer(21);
            var view = new DataView(msg);
            view.setUint8(0, 16);
            view.setFloat64(1, X, true);
            view.setFloat64(9, Y, true);
            view.setUint32(17, 0, true);
            wsSend(msg)
        }
    }

    function sendChat(str) {
        if (wsIsOpen() && (str.length < 200) && (0 != str.length)) {
            var msg = new ArrayBuffer(2 + 2 * str.length),
                view = new DataView(msg);
            view.setUint8(0, 99);
            view.setUint8(1, 0);
            for (var i = 0; i < str.length; ++i) view.setUint16(2 + 2 * i, str.charCodeAt(i), true);
            wsSend(msg)
        }
    }

    function sendUint8(a) {
        if (wsIsOpen()) {
            var msg = new ArrayBuffer(1);
            (new DataView(msg)).setUint8(0, a);
            wsSend(msg)
        }
    }

    function onWsOpen() {
        hideConnecting();
        sendNickName();
        ua = false
    }

    function onWsClose() {
        hideConnecting();
        setTimeout(showOverlays, 1E3);
        ua = true
    }

    function wsIsOpen() {
        return null != ws && ws.readyState == ws.OPEN
    }

    function sendNickName() {
        if (wsIsOpen() && null != userNickName) {
            var msg = new ArrayBuffer(1 + 2 * userNickName.length),
                view = new DataView(msg);
            view.setUint8(0, 0);
            for (var i = 0; i < userNickName.length; ++i) view.setUint16(1 + 2 * i, userNickName.charCodeAt(i), true);
            wsSend(msg)
        }
    }

    function onWsMessage(msg) {
        handleWsMessage(new DataView(msg.data))
    }

    function handleWsMessage(msg) {
        function getString() {
            var text = '',
                char;
            while ((char = msg.getUint16(offset, true)) != 0) {
                offset += 2;
                text += String.fromCharCode(char);
            }
            offset += 2;
            return text;
        }

        var offset = 0;
        switch (msg.getUint8(offset++)) {
            case 16:
                updateNodes(msg, offset);
                break;
            case 17:
                posX = msg.getFloat32(offset, true);
                offset += 4;
                posY = msg.getFloat32(offset, true);
                offset += 4;
                posSize = msg.getFloat32(offset, true);
                offset += 4;
                break;
            case 20:
                playerCells = [];
                nodesOnScreen = [];
                break;
            case 21:
                lineX = msg.getInt16(offset, true);
                offset += 2;
                lineY = msg.getInt16(offset, true);
                offset += 2;
                break;
            case 32:
                nodesOnScreen.push(msg.getUint32(offset, true));
                offset += 4;
                break;
            case 48:
                setCellColors(msg.getUint8(offset++), msg.getUint8(offset++), msg.getUint8(offset++));
                break;
            case 49:
                if (null == lbCanvas) {
                    lbCanvas = document.createElement('canvas');
                    lbctx = lbCanvas.getContext('2d');
                }
                var lb = getString();
                leaderboard = [];
                for (i = 0; i < lb.length; ++i) leaderboard.push(lb.charCodeAt(i));
                drawLeaderboard();
                break;
            case 50:
                if (null == lbCanvas) {
                    lbCanvas = document.createElement('canvas');
                    lbctx = lbCanvas.getContext('2d');
                }
                teams = [];
                for (var a = 0; a < msg.getUint32(offset, true); ++a) offset += 4, teams.push(msg.getFloat32(offset, true)), offset += 4;
                drawLeaderboard();
                break;
            case 64:
                leftPos = msg.getFloat64(offset, true);
                offset += 8;
                topPos = msg.getFloat64(offset, true);
                offset += 8;
                rightPos = msg.getFloat64(offset, true);
                offset += 8;
                bottomPos = msg.getFloat64(offset, true);
                offset += 8;
                posX = (leftPos + rightPos) / 2;
                posY = (topPos + bottomPos) / 2;
                posSize = 1;
                if (0 == playerCells.length) {
                    nodeX = posX;
                    nodeY = posY;
                    viewZoom = posSize
                }
                break;
            case 81:
                var packetLength = msg.byteLength;
                teamScores = [];
                for (var i = 0; i < packetLength; i += 4) {
                    teamScores.push(msg.getFloat32(i, true));
                }
                drawLeaderboard();
                break;
            case 99:
                if (null == chatCanvas) {
                    chatCanvas = document.createElement('canvas');
                    chatCtx = chatCanvas.getContext('2d');
                }
                var flags = msg.getUint8(offset++),
                    r = 0,
                    g = 0,
                    b = 0;
                if (flags & 2) offset += 4;
                if (flags & 4) offset += 8;
                if (flags & 8) offset += 16;
                if (flags & 1) {
                    r = msg.getUint8(offset++);
                    g = msg.getUint8(offset++);
                    b = msg.getUint8(offset++);
                }
                var name = getString();
                var message = getString();
                chatBoard.push({
                    name: name,
                    color: (r << 16) | (g << 8) | b,
                    message: message,
                    time: Date.now()
                });
                drawChat();
                break;
        }
    }

    function setCellColors(r, g, b) {
        playerColor = 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    function drawLeaderboard() {
        lbCanvas.width = 200;
        lbCanvas.height = 240;
        var ctx = lbctx;
        ctx.clearRect(0, 0, 200, 240);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 200, 240);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '30px Ubuntu';
        ctx.fillText('Leaderboard', 50, 40);
        if (null == teams || 0 == teams.length)
            for (ctx.font = '20px Ubuntu', i = 0; i < leaderboard.length; ++i) {
                var isMe = leaderboard[i].toLowerCase() == userNickName.toLowerCase();
                if (isMe) ctx.fillStyle = '#FFAAAA';
                ctx.fillText((i + 1) + '. ' + leaderboard[i], 10, 70 + 24 * i);
                if (isMe) ctx.fillStyle = '#FFFFFF';
            }
        else
            for (i = 0; i < teams.length; ++i) {
                var c = 0;
                3 > i && (c = 0);
                6 > i && 2 < i && (c = 1);
                9 > i && 5 < i && (c = 2);
                ctx.fillStyle = ["#FF3333", "#33FF33", "#3333FF"][c];
                ctx.beginPath();
                var a = 100,
                    b = 140,
                    angle = 2 * Math.PI * teams[i],
                    start = Math.PI * -1 / 2;
                ctx.arc(a, b, 80, start, angle + start, false);
                ctx.lineTo(a, b);
                ctx.fill();
            }
    }

    function drawChat() {
        if (!chatCanvas || hideChat) return;
        var ctx = chatCtx,
            now = Date.now(),
            messages = [];
        for (var i = 0; i < chatBoard.length; ++i)
            if (now - chatBoard[i].time <= 15000) messages.push(chatBoard[i]);
        chatBoard = messages;
        var maxLength = 0;
        for (i = 0; i < chatBoard.length; ++i) {
            var playerName = chatBoard[i].name;
            var msg = chatBoard[i].message;
            ctx.font = '18px Ubuntu';
            maxLength = Math.max(maxLength, ctx.measureText(playerName + ': ' + msg).width);
        }
        chatCanvas.width = maxLength + 20;
        chatCanvas.height = 24 * chatBoard.length + 10;
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, chatCanvas.width, chatCanvas.height);
        ctx.globalAlpha = 1;
        for (i = 0; i < chatBoard.length; ++i) {
            var y = 24 * (i + 1);
            ctx.font = '18px Ubuntu';
            ctx.fillStyle = '#' + ('00000' + chatBoard[i].color.toString(16)).slice(-6);
            ctx.fillText(chatBoard[i].name + ':', 10, y);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(' ' + chatBoard[i].message, 16 + ctx.measureText(chatBoard[i].name + ':').width, y);
        }
    }

    function Cell(id, x, y, size, color, name) {
        this.id = id;
        this.ox = this.x = x;
        this.oy = this.y = y;
        this.oSize = this.size = size;
        this.color = color;
        this.points = [];
        this.pointsAcc = [];
        this.createPoints();
        this.setName(name)
    }

    function UText(size, color, stroke, strokeColor) {
        this._size = size;
        this._color = color;
        this._stroke = stroke;
        this._strokeColor = strokeColor;
        this._dirty = false
    }

    if (null != wHandle.localStorage) {
        if (null == wHandle.localStorage.AB8) {
            wHandle.localStorage.AB8 = ["", "ws://localhost:8080", true, true, false, false, false, false, false];
        }
        ABGroup = wHandle.localStorage.AB8.split(',');
        wjQuery('.save').each(function() {
            var boxId = $(this).attr('data-box-id');
            if (null !== ABGroup[boxId]) {
                if ($(this).attr('type') == 'checkbox') {
                    $(this).prop('checked', 'true' === ABGroup[boxId]);
                } else {
                    $(this).val(ABGroup[boxId]);
                }
            }
            $(this).change(function() {
                var boxId = $(this).attr('data-box-id');
                if ($(this).attr('type') == 'checkbox') {
                    ABGroup[boxId] = $(this).is(':checked');
                } else {
                    ABGroup[boxId] = $(this).val();
                }
                wHandle.localStorage.AB8 = ABGroup.toString();
            });
        });
    }

    function showDarkThemeOnStart() {
        setDarkTheme(wjQuery('input[data-box-id="4"]').is(':checked'));
    }

    function setSkins(a) {
        showSkin = a;
    }

    function setNames(a) {
        showName = a;
    }

    function setDarkTheme(a) {
        showDarkTheme = a;
    }

    function setColors(a) {
        showColor = !a;
    }

    function setShowMass(a) {
        showMass = a;
    }

    function setSmooth(a) {
        xa = a;
    }

    function setChatHide(a) {
        hideChat = a;
    }

    function spectate() {
        userNickName = null;
        hideOverlays();
        sendUint8(1);
        wsConnect();
    }

    function setNick(arg) {
        hideOverlays();
        userNickName = arg;
        sendNickName();
    }

    function setRegion(a) {
        if (a) {
            wjQuery(".region-message").hide();
            wjQuery(".region-message." + a).show();
            wjQuery(".btn-needs-server").prop("disabled", false);
            if (null != localStorage.location) wjQuery("#region").val(localStorage.location);
            else wjQuery("#region").val(a);
            localStorage.location = a;
        }
    }

    function openSkinsList() {
        wjQuery("#inPageModalTitle").text("Skins Gallery");
        wjQuery("#inPageModalBody").html("<iframe src='include/gallery.php' style='width:100%; border:none; min-height:400px;'></iframe>");
    }

    function viewRange() {
        return Math.max(canvasHeight / 1080, canvasWidth / 1920)
    }

    function calcViewZoom() {
        for (var a = 0, b = 0; b < playerCells.length; ++b) a += playerCells[b].size;
        a = Math.pow(Math.min(64 / a, 1), .4) * viewRange();
        viewZoom = (9 * viewZoom + a) / 10;
    }

    function canvasResize() {
        canvasWidth = wHandle.innerWidth;
        canvasHeight = wHandle.innerHeight;
        nCanvas.width = canvasWidth;
        nCanvas.height = canvasHeight;
        drawGameScene();
    }

    function updateNodes(view, offset) {
        timestamp = +new Date;
        var code = Math.random();
        ua = false;
        for (var i = 0; i < view.getUint16(offset, true); ++i) {
            var killer = nodes[view.getUint32(offset + 2, true)],
                killed = nodes[view.getUint32(offset + 6, true)];
            offset += 8;
            if (killer && killed) {
                killed.destroy();
                killed.ox = killed.x;
                killed.oy = killed.y;
                killed.oSize = killed.size;
                killed.nx = killer.x;
                killed.ny = killer.y;
                killed.nSize = killer.size;
                killed.updateTime = timestamp;
            }
        }
        for (;;) {
            var id = view.getUint32(offset, true);
            offset += 4;
            if (0 == id) break;
            var x = view.getInt32(offset, true);
            offset += 4;
            var y = view.getInt32(offset, true);
            offset += 4;
            var size = view.getInt16(offset, true);
            offset += 2;
            var flags = view.getUint8(offset++),
                color = null,
                name = null,
                skin = null,
                virus = false,
                agitated = false;
            if (flags & 1) {
                var r = view.getUint8(offset++),
                    g = view.getUint8(offset++),
                    b = view.getUint8(offset++);
                color = 'rgb(' + r + ',' + g + ',' + b + ')';
            }
            if (flags & 2) skin = getString();
            if (flags & 4) name = getString();
            if (flags & 8) virus = true;
            if (flags & 16) agitated = true;
            var node = null;
            if (nodes.hasOwnProperty(id)) {
                node = nodes[id];
                node.updatePos();
                node.ox = node.x;
                node.oy = node.y;
                node.oSize = node.size;
                node.color = color || node.color;
            } else {
                node = new Cell(id, x, y, size, color, name);
                nodes[id] = node;
                nodelist.push(node);
            }
            node.isVirus = virus;
            node.isAgitated = agitated;
            node.nx = x;
            node.ny = y;
            node.nSize = size;
            node.updateCode = code;
            node.updateTime = timestamp;
            if (name) node.setName(name);
            if (skin) node.setSkin(skin);
            if (-1 != nodesOnScreen.indexOf(id) && -1 == playerCells.indexOf(node)) {
                document.getElementById("overlays").style.display = "none";
                playerCells.push(node);
                if (1 == playerCells.length) {
                    nodeX = node.x;
                    nodeY = node.y;
                }
            }
        }
        for (i = 0; i < nodelist.length; i++) {
            node = nodelist[i];
            if (node.updateCode != code) {
                node.destroy();
                nodelist.splice(i, 1);
                delete nodes[node.id];
                i--;
            }
        }
        ua && 0 == playerCells.length && showOverlays(false)
    }

    wHandle.setSkins = setSkins;
    wHandle.setNames = setNames;
    wHandle.setDarkTheme = setDarkTheme;
    wHandle.setColors = setColors;
    wHandle.setShowMass = setShowMass;
    wHandle.setSmooth = setSmooth;
    wHandle.setChatHide = setChatHide;
    wHandle.spectate = spectate;
    wHandle.setNick = setNick;
    wHandle.setRegion = setRegion;
    wHandle.openSkinsList = openSkinsList;
    var qTree = null,
        ws = null,
        logger = null,
        nCanvas = null,
        ctx = null,
        mainCanvas = null,
        ua = false,
        showSkin = true,
        showName = true,
        showDarkTheme = false,
        showColor = true,
        showMass = false,
        showFood = true,
        showMapBorders = true,
        showGrid = true,
        showMinimap = false,
        showChat = true,
        hideChat = false,
        showBorder = false,
        xa = false,
        posX = ~~((rightPos + leftPos) / 2),
        posY = ~~((bottomPos + topPos) / 2),
        posSize = 1,
        nodeX = posX,
        nodeY = posY,
        viewZoom = 1,
        userNickName = null,
        leftPos = 0,
        topPos = 0,
        rightPos = 0,
        bottomPos = 0,
        rawMouseX = 0,
        rawMouseY = 0,
        X = -1,
        Y = -1,
        nodes = {},
        nodelist = [],
        playerCells = [],
        nodesOnScreen = [],
        foods = [],
        viruses = [],
        leaderboard = [],
        teams = [],
        teamScores = [],
        playerColor = null,
        lineX = 0,
        lineY = 0,
        scoreText = null,
        score = 0,
        userScore = 0,
        chatBoard = [],
        lbCanvas = null,
        lbctx = null,
        chatCanvas = null,
        chatCtx = null,
        hasOverlay = true,
        ma = false,
        timestamp = 0,
        zoom = 1,
        startPingTime = Date.now(),
        useUtf8 = true,
        rMacro = false;

    if (touchable) {
        leftTouchStartPos = new Vector2(0, 0);
        leftTouchPos = new Vector2(0, 0);
        leftVector = new Vector2(0, 0);
    }

    Cell.prototype = {
        id: 0,
        points: null,
        pointsAcc: null,
        name: null,
        nameCache: null,
        sizeCache: null,
        x: 0,
        y: 0,
        size: 0,
        ox: 0,
        oy: 0,
        oSize: 0,
        nx: 0,
        ny: 0,
        nSize: 0,
        updateTime: 0,
        updateCode: 0,
        drawTime: 0,
        destroyed: false,
        isVirus: false,
        isAgitated: false,
        wasSimpleDrawing: true,
        destroy: function() {
            var index;
            if (-1 != (index = playerCells.indexOf(this))) playerCells.splice(index, 1);
            if (-1 != (index = nodesOnScreen.indexOf(this.id))) nodesOnScreen.splice(index, 1);
            this.destroyed = true;
            if (-1 != (index = nodelist.indexOf(this))) nodelist.splice(index, 1);
            delete nodes[this.id];
            index = foods.indexOf(this);
            if (-1 != index) foods.splice(index, 1);
        },
        createPoints: function() {
            for (var i = this.getNumPoints(); this.points.length > i;) {
                var p = { size: this.size, x: this.x, y: this.y, rl: this.size };
                this.points.push(p);
                this.pointsAcc.push(Math.random() - .5);
            }
            while (this.points.length < i) {
                p = this.points.pop();
                this.pointsAcc.pop();
            }
        },
        getNumPoints: function() {
            var num = 10;
            if (20 > this.size) num = 5;
            if (this.isVirus) num = 30;
            return num;
        },
        movePoints: function() {
            this.createPoints();
            for (var i = 0; i < this.points.length; ++i) {
                var prev = this.pointsAcc[(i - 1 + this.points.length) % this.points.length],
                    cur = this.pointsAcc[i],
                    next = this.pointsAcc[(i + 1) % this.points.length];
                this.pointsAcc[i] += (Math.random() - .5) * (this.isAgitated ? 3 : 1);
                this.pointsAcc[i] *= .7;
                10 < this.pointsAcc[i] && (this.pointsAcc[i] = 10);
                -10 > this.pointsAcc[i] && (this.pointsAcc[i] = -10);
                this.pointsAcc[i] = (prev + cur + next) / 3;
            }
            for (i = 0; i < this.points.length; ++i) {
                prev = this.points[(i - 1 + this.points.length) % this.points.length].rl;
                cur = this.points[i].rl;
                next = this.points[(i + 1) % this.points.length].rl;
                if (this.isVirus && 0 == i % 2) {
                    prev += 5;
                    next += 5;
                }
                cur += this.pointsAcc[i];
                cur = Math.max(cur, this.size - 3);
                cur = Math.min(cur, this.size + 3);
                this.points[i].rl = (prev + cur + next) / 8 * 3;
            }
            var x = this.x,
                y = this.y;
            for (i = 0; i < this.points.length; ++i) {
                var angle = 2 * Math.PI * i / this.points.length,
                    rl = this.points[i].rl;
                this.points[i].x = x + Math.cos(angle) * rl;
                this.points[i].y = y + Math.sin(angle) * rl;
            }
        },
        updatePos: function() {
            var dt = (timestamp - this.updateTime) / 120;
            dt = Math.max(Math.min(dt, 1), 0);
            this.drawTime = dt;
            if (this.destroyed && 1 <= dt) {
                var i = nodelist.indexOf(this);
                if (-1 != i) nodelist.splice(i, 1);
            }
            this.x = this.ox + (this.nx - this.ox) * dt;
            this.y = this.oy + (this.ny - this.oy) * dt;
            this.size = this.oSize + (this.nSize - this.oSize) * dt;
            return dt;
        },
        shouldRender: function() {
            return this.x + this.size + 40 >= posX - canvasWidth / 2 / viewZoom && this.y + this.size + 40 >= posY - canvasHeight / 2 / viewZoom && this.x - this.size - 40 <= posX + canvasWidth / 2 / viewZoom && this.y - this.size - 40 <= posY + canvasHeight / 2 / viewZoom;
        },
        draw: function() {
            if (!this.shouldRender()) return;
            var pointsLength;
            if (this.wasSimpleDrawing && this.size < 20 && !this.isVirus) pointsLength = 0;
            else pointsLength = this.points.length;
            this.movePoints();
            ctx.save();
            this.drawShape(pointsLength);
            this.drawSkin();
            this.drawText();
            ctx.restore();
        },
        drawShape: function(pointsLength) {
            ctx.beginPath();
            if (this.isVirus) {
                var angle = 0;
                for (var i = 0; i < pointsLength; ++i) {
                    var point = this.points[i];
                    angle += Math.PI * 2 / pointsLength;
                    if (0 == i) ctx.moveTo(point.x, point.y);
                    else ctx.lineTo(point.x, point.y);
                }
            } else if (0 == pointsLength) {
                ctx.arc(this.x, this.y, this.size, 0, 2 * Math.PI, false);
            } else {
                var point = this.points[0];
                ctx.moveTo(point.x, point.y);
                for (i = 1; i <= pointsLength; ++i) {
                    point = this.points[i % pointsLength];
                    ctx.lineTo(point.x, point.y);
                }
            }
            ctx.closePath();
            ctx.fillStyle = showColor ? this.color : '#FFFFFF';
            ctx.strokeStyle = showColor ? this.color : '#AAAAAA';
            ctx.lineWidth = 10;
            ctx.lineCap = 'round';
            ctx.lineJoin = this.isVirus ? 'miter' : 'round';
            ctx.fill();
            if (this.size > 20) ctx.stroke();
        },
        drawSkin: function() {
            if (showSkin && this.skin && this.skinCanvas && this.skinCanvas.complete && this.skinCanvas.width && this.skinCanvas.height) {
                ctx.save();
                ctx.clip();
                ctx.drawImage(this.skinCanvas, this.x - this.size, this.y - this.size, 2 * this.size, 2 * this.size);
                ctx.restore();
            }
        },
        setSkin: function(name) {
            if (name) {
                this.skin = name;
                this.skinCanvas = new Image;
                this.skinCanvas.src = SKIN_URL + name + '.png';
            }
        },
        drawText: function() {
            if (this.name && showName) {
                if (null == this.nameCache) this.nameCache = new UText(24, '#FFFFFF', true, '#000000');
                this.nameCache.setSize(Math.max(24 * this.size / 40, 24));
                this.nameCache.setValue(this.name);
                var nameImage = this.nameCache.render();
                var w = ~~(nameImage.width / 2);
                ctx.drawImage(nameImage, ~~this.x - w, ~~this.y - ~~this.size / 2);
            }
            if (showMass && (this.size > 20)) {
                if (null == this.sizeCache) this.sizeCache = new UText(24, '#FFFFFF', true, '#000000');
                this.sizeCache.setSize(Math.max(24 * this.size / 40, 24));
                this.sizeCache.setValue(~~(this.size * this.size / 100));
                var sizeImage = this.sizeCache.render();
                w = ~~(sizeImage.width / 2);
                ctx.drawImage(sizeImage, ~~this.x - w, ~~this.y + ~~this.size / 4);
            }
        },
        setName: function(name) {
            this.name = name;
            if (this.nameCache) this.nameCache.setValue(this.name);
        }
    };

    UText.prototype = {
        _value: '',
        _color: '#000000',
        _stroke: false,
        _strokeColor: '#000000',
        _size: 16,
        _canvas: null,
        _ctx: null,
        _dirty: false,
        setSize: function(size) {
            if (this._size != size) {
                this._size = size;
                this._dirty = true;
            }
        },
        setColor: function(color) {
            if (this._color != color) {
                this._color = color;
                this._dirty = true;
            }
        },
        setStroke: function(stroke) {
            if (this._stroke != stroke) {
                this._stroke = stroke;
                this._dirty = true;
            }
        },
        setStrokeColor: function(strokeColor) {
            if (this._strokeColor != strokeColor) {
                this._strokeColor = strokeColor;
                this._dirty = true;
            }
        },
        setValue: function(value) {
            if (value != this._value) {
                this._value = value;
                this._dirty = true;
            }
        },
        render: function() {
            if (null == this._canvas) {
                this._canvas = document.createElement('canvas');
                this._ctx = this._canvas.getContext('2d');
            }
            if (this._dirty) {
                this._dirty = false;
                var canvas = this._canvas,
                    ctx = this._ctx,
                    size = this._size,
                    font = size + 'px Ubuntu';
                ctx.font = font;
                var width = ctx.measureText(this._value).width + 6;
                canvas.width = width;
                canvas.height = size + 10;
                ctx.font = font;
                ctx.globalAlpha = 1;
                ctx.lineWidth = 3;
                ctx.strokeStyle = this._strokeColor;
                ctx.fillStyle = this._color;
                if (this._stroke) ctx.strokeText(this._value, 3, size);
                ctx.fillText(this._value, 3, size);
            }
            return this._canvas;
        }
    };

    gameLoop();
})(window, window.jQuery);
