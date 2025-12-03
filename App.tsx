import React, { useState, useEffect } from 'react';
import {
    SafeAreaView,
    StyleSheet,
    ScrollView,
    View,
    Text,
    StatusBar,
    Button,
    FlatList,
    TouchableOpacity,
    TextInput,
    Platform,
    PermissionsAndroid,
    NativeModules,
    NativeEventEmitter,
} from 'react-native';
import BleManager from 'react-native-ble-manager';
import xBlufi from '@kafudev/react-native-esp-blufi';

const App = () => {
    const [isScanning, setIsScanning] = useState(false);
    const [peripherals, setPeripherals] = useState(new Map());
    const [connectedDevice, setConnectedDevice] = useState(null);
    const [logs, setLogs] = useState([]);
    const [ssid, setSsid] = useState('');
    const [password, setPassword] = useState('');
    const [customData, setCustomData] = useState('12:');

    const [isBluetoothReady, setIsBluetoothReady] = useState(false);

    const addLog = (msg) => {
        console.log(msg);
        setLogs((prev) => [msg, ...prev]);
    };

    useEffect(() => {
        // Init BleManager directly to ensure it's ready
        BleManager.start({ showAlert: false }).then(() => {
            addLog('BleManager initialized');
            // Check state immediately
            BleManager.checkState().then((state) => {
                addLog(`Initial Bluetooth state: ${state}`);
                if (state === 'on') setIsBluetoothReady(true);
            });
        });

        const handleUpdateState = (args) => {
            addLog(`BleManager state: ${args.state}`);
            if (args.state === 'on') {
                setIsBluetoothReady(true);
            } else {
                setIsBluetoothReady(false);
            }
        };

        const bleManagerEmitter = new NativeEventEmitter(NativeModules.BleManager);
        const stateListener = bleManagerEmitter.addListener('BleManagerDidUpdateState', handleUpdateState);

        // Init xBlufi
        xBlufi.initXBlufi(xBlufi.XMQTT_SYSTEM.ReactNative, {});

        // Listeners
        xBlufi.listenStartDiscoverBle(true, (data) => {
            // addLog(`Discover event: ${JSON.stringify(data)}`);
            if (data && data.id) {
                setPeripherals((map) => {
                    return new Map(map.set(data.id, data));
                });
            }
        });

        xBlufi.listenConnectBle(true, (isConnected) => {
            addLog(`Connection status: ${JSON.stringify(isConnected)}`);
            if (!isConnected) {
                setConnectedDevice(null);
            }
        });

        xBlufi.listenDeviceMsgEvent(true, (data) => {
            addLog(`Device Msg: ${JSON.stringify(data)}`);
            // Handle custom data response
            if (data.type === xBlufi.XBLUFI_TYPE.TYPE_RECIEVE_CUSTON_DATA) {
                addLog(`Received Custom Data: ${data.data}`);
            }
            if (data.type === xBlufi.XBLUFI_TYPE.TYPE_STATUS_CONNECTED) {
                // Connected
            }
        });

        return () => {
            stateListener.remove();
            xBlufi.listenStartDiscoverBle(false, () => { });
            xBlufi.listenConnectBle(false, () => { });
            xBlufi.listenDeviceMsgEvent(false, () => { });
        };
    }, []);

    const [manualDeviceId, setManualDeviceId] = useState('');

    const startScan = async () => {
        if (!isBluetoothReady) {
            addLog('Bluetooth is not ready yet. Please wait or check settings.');
            // Try checking state again
            BleManager.checkState().then(state => {
                if (state === 'on') setIsBluetoothReady(true);
            });
            return;
        }
        if (Platform.OS === 'android' && Platform.Version >= 23) {
            const granted = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
            );
            if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
                addLog('Location permission denied');
                return;
            }
            if (Platform.Version >= 31) {
                await PermissionsAndroid.requestMultiple([
                    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
                ]);
            }
        }

        setPeripherals(new Map());
        setIsScanning(true);
        addLog('Starting scan...');
        // Try xBlufi scan
        xBlufi.notifyStartDiscoverBle({ isStart: true });

        // Also try direct BleManager scan as backup/force
        BleManager.scan({ serviceUUIDs: [], seconds: 5, allowDuplicates: true }).then(() => {
            addLog('BleManager direct scan started');
        }).catch(err => {
            addLog(`BleManager scan error: ${err}`);
        });

        // Stop scan after 5s
        setTimeout(() => {
            setIsScanning(false);
            xBlufi.notifyStartDiscoverBle({ isStart: false });
            BleManager.stopScan();
            addLog('Scan stopped');
        }, 5000);
    };

    const manualConnect = () => {
        if (manualDeviceId) {
            addLog(`Searching for device matching: ${manualDeviceId}...`);

            // Start scanning to find the device by Name or ID
            setIsScanning(true);
            BleManager.scan({ serviceUUIDs: [], seconds: 5, allowDuplicates: true }).then(() => {
                addLog('Scanning for target device...');
            });

            // We need to hook into the scan results to find the match
            // Since we can't easily hook the existing listener from here without refactoring,
            // we'll rely on the main listener updating 'peripherals'
            // and add a temporary check or just let the user see it.

            // BUT, to be helpful, let's try to connect if we find it in the map *after* a short delay
            // or iterate existing peripherals immediately.

            let found = false;
            peripherals.forEach((p) => {
                if (p.id === manualDeviceId || p.name === manualDeviceId) {
                    addLog(`Found match in cache: ${p.id}`);
                    connect(p);
                    found = true;
                }
            });

            if (!found) {
                addLog("Device not in cache, scanning...");
                // The user will have to tap it in the list if it appears, 
                // or we could add a 'useEffect' to auto-connect if manualDeviceId matches.
                // For now, let's just scan.
            }
        }
    };

    const connect = (peripheral) => {
        addLog(`Connecting to ${peripheral.id}...`);
        xBlufi.notifyConnectBle({ connect: true, deviceId: peripheral.id });
        setConnectedDevice(peripheral); // Optimistic update, real status comes from listener
    };

    const disconnect = () => {
        if (connectedDevice) {
            xBlufi.notifyConnectBle({ connect: false, deviceId: connectedDevice.id });
            setConnectedDevice(null);
        }
    };

    const initEsp32 = () => {
        if (connectedDevice) {
            addLog('Initializing ESP32...');
            xBlufi.notifyInitBleEsp32({ deviceId: connectedDevice.id });
        }
    }

    const configure = () => {
        addLog(`Configuring SSID: ${ssid}`);
        xBlufi.notifySendRouterSsidAndPassword({ ssid: ssid, password: password });
    };

    const sendCustomData = () => {
        addLog(`Sending custom data: ${customData}`);
        xBlufi.notifySendCustomData({ customData: customData });
    };

    const renderItem = ({ item }) => (
        <TouchableOpacity onPress={() => connect(item)} style={styles.deviceItem}>
            <Text style={styles.deviceName}>{item.name || 'Unknown'}</Text>
            <Text style={styles.deviceId}>{item.id}</Text>
        </TouchableOpacity>
    );

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" />
            <View style={styles.header}>
                <Text style={styles.title}>Blufi Expo Test</Text>
                <Button title={isScanning ? 'Scanning...' : 'Scan'} onPress={startScan} disabled={isScanning} />
            </View>

            <View style={styles.section}>
                <TextInput
                    style={styles.input}
                    placeholder="Device Name or ID"
                    value={manualDeviceId}
                    onChangeText={setManualDeviceId}
                />
                <Button title="Scan & Connect" onPress={manualConnect} />
            </View>

            {!connectedDevice ? (
                <FlatList
                    data={Array.from(peripherals.values())}
                    renderItem={renderItem}
                    keyExtractor={(item) => item.id}
                    style={styles.list}
                />
            ) : (
                <ScrollView style={styles.controlPanel}>
                    <View style={styles.deviceInfo}>
                        <Text>Connected to: {connectedDevice.name}</Text>
                        <Button title="Disconnect" onPress={disconnect} color="red" />
                    </View>

                    <View style={styles.section}>
                        <Button title="Init ESP32 (Negotiate)" onPress={initEsp32} />
                    </View>

                    <View style={styles.section}>
                        <TextInput
                            style={styles.input}
                            placeholder="SSID"
                            value={ssid}
                            onChangeText={setSsid}
                        />
                        <TextInput
                            style={styles.input}
                            placeholder="Password"
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry
                        />
                        <Button title="Configure Wi-Fi" onPress={configure} />
                    </View>

                    <View style={styles.section}>
                        <TextInput
                            style={styles.input}
                            placeholder="Custom Data (e.g. 12:)"
                            value={customData}
                            onChangeText={setCustomData}
                        />
                        <Button title="Send Custom Data" onPress={sendCustomData} />
                    </View>
                </ScrollView>
            )}

            <View style={styles.logs}>
                <Text style={styles.logsTitle}>Logs:</Text>
                <FlatList
                    data={logs}
                    renderItem={({ item }) => <Text style={styles.logItem}>{item}</Text>}
                    keyExtractor={(item, index) => index.toString()}
                />
            </View>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    header: {
        padding: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#ddd',
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    list: {
        flex: 1,
    },
    deviceItem: {
        padding: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    deviceName: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    deviceId: {
        fontSize: 12,
        color: '#888',
    },
    controlPanel: {
        flex: 1,
        padding: 16,
    },
    deviceInfo: {
        marginBottom: 20,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    section: {
        marginBottom: 20,
        padding: 16,
        backgroundColor: '#fff',
        borderRadius: 8,
    },
    input: {
        borderWidth: 1,
        borderColor: '#ddd',
        padding: 10,
        marginBottom: 10,
        borderRadius: 4,
    },
    logs: {
        height: 150,
        backgroundColor: '#333',
        padding: 10,
    },
    logsTitle: {
        color: '#fff',
        fontWeight: 'bold',
        marginBottom: 5,
    },
    logItem: {
        color: '#0f0',
        fontSize: 12,
    },
});

export default App;
