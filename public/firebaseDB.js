<!-- firebaseDB.js (modo clásico, sin imports ni workers) -->
<script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js"></script>
<script>
  const firebaseConfig = {
    apiKey: "AIzaSyB0vz-jtc7PRpdFfQUKvU9PevLEV8zYzO4",
    authDomain: "nextlives-panel-soporte.firebaseapp.com",
    projectId: "nextlives-panel-soporte",
    storageBucket: "nextlives-panel-soporte.appspot.com",
    messagingSenderId: "52725281576",
    appId: "1:52725281576:web:4402c0507962074345161d"
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  window.firestore = {
    db: db,
    collection: (...args) => db.collection(...args),
    doc: (...args) => db.doc(...args),
    query: (...args) => args[0], // En compat, no se necesita query wrapper
    where: (...args) => firebase.firestore.FieldPath.documentId().where(...args),
    onSnapshot: (...args) => firebase.firestore().onSnapshot(...args)
  };
</script>
