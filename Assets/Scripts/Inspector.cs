using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using TMPro;

public struct Param
{
    public string name;
    public UnityAction<string> callback;
    public GameObject inputGroup;
    public TMP_InputField inputField;
    public string intialValue;
}

public class Inspector : MonoBehaviour
{
    public GameObject selected;
    public TextMeshProUGUI header;
    public GameObject inpugGroup;
    
    private List<Param> parameters = new List<Param>();
    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }

    private void Clear()
    {
        for (int i=0;i<parameters.Count;i++)
        {
            Destroy(parameters[i].inputGroup);
            // parameters.RemoveAt(i);
        }
        parameters = new List<Param>();
    }


    public void Edit(GameObject GO, string name, List<Param> _parameters)
    {
        selected = GO;
        header.text = name;  
        Clear();
        for (int i = 0; i < _parameters.Count; i++)
        {   
            Param p = _parameters[i];
            p.inputGroup = Instantiate(inpugGroup, Vector3.zero, Quaternion.identity);
            p.inputGroup.transform.SetParent(gameObject.transform);           
            p.inputGroup.transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = p.name;
            p.inputField = p.inputGroup.transform.GetChild(1).GetComponent<TMP_InputField>();
            p.inputField.text = p.intialValue;
            p.inputField.onEndEdit.AddListener(p.callback);
            parameters.Add(p);
        }
          
    }
}
