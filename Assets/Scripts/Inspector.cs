using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using TMPro;

public struct Param
{
    public string name;
    public System.Action<string> callback;
    public GameObject inputGroup;
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
        foreach (var p in parameters)
        {
            Destroy(p.inputGroup);
            parameters.Remove(p);
        }
    }


    public void Edit(GameObject GO, string name, List<Param> _parameters)
    {
        selected = GO;
        header.text = name;  
        Clear();
        for (int i = 0; i < _parameters.Count; i++)
        {   
            Param p = _parameters[i];
            var inputGroup = Instantiate(inpugGroup, Vector3.zero, Quaternion.identity);
            inputGroup.transform.SetParent(transform);
            p.inputGroup = inpugGroup;
            inpugGroup.transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = p.name;
            parameters.Add(p);
        }
          
    }
}
