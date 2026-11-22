(() => {
  const sdkVersion = "13.4.0";
  const sdkBase = `https://www.gstatic.com/firebasejs/${sdkVersion}`;

  window.RaceRobotFirebaseReady = (async () => {
    try {
      const configResponse = await fetch("/api/firebase-config", { cache: "no-store" });
      const config = await configResponse.json();
      if (!configResponse.ok) throw new Error(config.error || "Firebase yapılandırması alınamadı.");

      const [appSdk, authSdk, firestoreSdk] = await Promise.all([
        import(`${sdkBase}/firebase-app.js`),
        import(`${sdkBase}/firebase-auth.js`),
        import(`${sdkBase}/firebase-firestore.js`)
      ]);

      const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(config);
      const auth = authSdk.getAuth(app);
      const db = firestoreSdk.getFirestore(app);
      const accountPath = (uid) => ["users", uid];

      async function loadMemory(user) {
        const [settingsSnapshot, chunksSnapshot] = await Promise.all([
          firestoreSdk.getDoc(firestoreSdk.doc(db, ...accountPath(user.uid), "memory", "state")),
          firestoreSdk.getDocs(firestoreSdk.collection(db, ...accountPath(user.uid), "memoryData"))
        ]);
        const memory = { predictions: [], outcomes: [], coupons: [] };
        let found = settingsSnapshot.exists() || chunksSnapshot.size > 0;
        if (settingsSnapshot.exists()) Object.assign(memory, settingsSnapshot.data());

        for (const chunkDocument of chunksSnapshot.docs) {
          const chunk = chunkDocument.data();
          if (["predictions", "outcomes", "coupons"].includes(chunk.kind) && Array.isArray(chunk.items)) {
            memory[chunk.kind].push(...chunk.items);
            found = true;
          }
        }

        if (!memory.legacyImported) {
          const legacyPath = accountPath(user.uid);
          const [userDocument, legacyDocuments, legacyCollections] = await Promise.all([
            firestoreSdk.getDoc(firestoreSdk.doc(db, ...legacyPath)),
            Promise.all([
              ["memory", "current"],
              ["memories", "current"],
              ["appMemory", "current"]
            ].map(([collectionName, documentId]) => firestoreSdk.getDoc(
              firestoreSdk.doc(db, ...legacyPath, collectionName, documentId)
            ))),
            Promise.all(["memory", "memories", "appMemory", "predictions", "outcomes", "coupons"].map((collectionName) =>
              firestoreSdk.getDocs(firestoreSdk.collection(db, ...legacyPath, collectionName))
            ))
          ]);
          const applyLegacyState = (source) => {
            const legacyState = source?.state && typeof source.state === "object" ? source.state : source;
            if (!legacyState || typeof legacyState !== "object") return;
            for (const key of ["predictions", "outcomes", "coupons"]) {
              if (Array.isArray(legacyState[key])) memory[key].push(...legacyState[key]);
            }
            for (const key of ["profiles", "modelWeights", "contextWeights", "contextReports", "trainingReport", "archiveRaceCount", "archiveLatestDate", "archiveSyncedAt", "localUpdatedAt"]) {
              if (legacyState[key] !== undefined && memory[key] === undefined) memory[key] = legacyState[key];
            }
          };

          if (userDocument.exists()) {
            applyLegacyState(userDocument.data());
            found = true;
          }
          for (const legacyDocument of legacyDocuments) {
            if (!legacyDocument.exists()) continue;
            applyLegacyState(legacyDocument.data());
            found = true;
          }
          for (let index = 0; index < legacyCollections.length; index += 1) {
            const collectionName = ["memory", "memories", "appMemory", "predictions", "outcomes", "coupons"][index];
            for (const legacyDocument of legacyCollections[index].docs) {
              const value = legacyDocument.data();
              if (["predictions", "outcomes", "coupons"].includes(collectionName)) {
                const records = Array.isArray(value.items) ? value.items : [value.item || { id: value.id || legacyDocument.id, ...value }];
                memory[collectionName].push(...records);
              } else {
                applyLegacyState(value);
              }
              found = true;
            }
          }
        }

        return found ? memory : null;
      }

      async function saveMemory(user, state) {
        const collectionReference = firestoreSdk.collection(db, ...accountPath(user.uid), "memoryData");
        const previousSnapshot = await firestoreSdk.getDocs(collectionReference);
        const previousDocuments = new Map(previousSnapshot.docs.map((document) => [document.id, document]));
        const personalOutcomes = (state.outcomes || []).filter((item) => !String(item.sourceKey || "").startsWith("tjk:"));
        const lists = {
          predictions: state.predictions || [],
          outcomes: personalOutcomes,
          coupons: state.coupons || []
        };
        const pending = new Map();

        for (const [kind, items] of Object.entries(lists)) {
          for (let offset = 0; offset < items.length; offset += 50) {
            const index = String(Math.floor(offset / 50)).padStart(4, "0");
            const documentId = `${kind}-${index}`;
            pending.set(documentId, {
              kind,
              items: items.slice(offset, offset + 50),
              schemaVersion: 1,
              updatedAt: firestoreSdk.serverTimestamp()
            });
          }
        }

        const batch = firestoreSdk.writeBatch(db);
        for (const [documentId, data] of pending) {
          batch.set(firestoreSdk.doc(collectionReference, documentId), data);
        }
        for (const [documentId, document] of previousDocuments) {
          const data = document.data();
          if (["predictions", "outcomes", "coupons"].includes(data.kind) && !pending.has(documentId)) {
            batch.delete(document.ref);
          }
        }

        const settings = {
          schemaVersion: 1,
          profiles: state.profiles || {},
          modelWeights: state.modelWeights || {},
          contextWeights: state.contextWeights || {},
          contextReports: state.contextReports || {},
          trainingReport: state.trainingReport || null,
          archiveRaceCount: Number(state.archiveRaceCount || 0),
          archiveLatestDate: String(state.archiveLatestDate || ""),
          archiveSyncedAt: String(state.archiveSyncedAt || ""),
          localUpdatedAt: String(state.localUpdatedAt || ""),
          updatedAt: firestoreSdk.serverTimestamp()
        };
        batch.set(firestoreSdk.doc(db, ...accountPath(user.uid), "memory", "state"), settings, { merge: true });
        await batch.commit();
      }

      return {
        ok: true,
        onAuthStateChanged: (callback) => authSdk.onAuthStateChanged(auth, callback),
        getIdToken: async () => {
          await auth.authStateReady();
          return auth.currentUser ? auth.currentUser.getIdToken() : null;
        },
        signIn: (email, password) => authSdk.signInWithEmailAndPassword(auth, email, password),
        createAccount: (email, password) => authSdk.createUserWithEmailAndPassword(auth, email, password),
        signOut: () => authSdk.signOut(auth),
        loadMemory,
        saveMemory
      };
    } catch (error) {
      return { ok: false, error: error?.message || "Firebase bağlantısı kurulamadı." };
    }
  })();
})();
